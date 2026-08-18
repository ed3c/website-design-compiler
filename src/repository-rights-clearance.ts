import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { isAbsolute, resolve, join, relative } from "node:path";

const execFileAsync = promisify(execFile);

export type RightsState = "ALLOW" | "REVIEW_REQUIRED" | "DENY" | "UNKNOWN" | "NOT_DISTRIBUTED";
export interface RightsSubject { id: string; kind: "package" | "asset" | "font" | "model" | "generated-output" | "service"; name: string; versionOrIdentity: string; licenseExpression: string | null; state: RightsState; evidence: string[]; attributionRequired: boolean; distributed: boolean; geographicRestrictions?: string[]; usageRestrictions?: string[]; }
export interface Waiver { subjectId: string; owner: string; rationale: string; scope: string; expiresAt: string; }
export interface RepositoryClearanceReceipt { schema: "website-design-compiler/repository-rights-clearance/v2"; overall: "PASS" | "FAIL"; generatedAt: string; subjects: RightsSubject[]; counts: Record<RightsState, number>; unresolved: string[]; expiredWaivers: string[]; diagnostics: string[]; noticeSubjects: string[]; legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE"; }

const PERMISSIVE = ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Unlicense", "CC0-1.0", "BlueOak-1.0.0", "Python-2.0", "WTFPL"];
const REVIEW_MARKERS = ["MPL", "EPL", "LGPL", "GPL", "AGPL", "CDDL", "OSL", "Artistic", "CC-BY"];
const DENY_MARKERS = ["NON-COMMERCIAL", "NONCOMMERCIAL", "NC-", "Commons-Clause", "PolyForm-Noncommercial"];

export function classifyLicense(expression: string | null): RightsState {
  if (!expression || expression.trim() === "" || expression === "NOASSERTION") return "UNKNOWN";
  const normalized = expression.replace(/[()]/g, " ").trim();
  if (DENY_MARKERS.some((marker) => normalized.toLowerCase().includes(marker.toLowerCase()))) return "DENY";
  if (REVIEW_MARKERS.some((marker) => normalized.includes(marker))) return "REVIEW_REQUIRED";
  const tokens = normalized.split(/\s+(?:OR|AND|WITH)\s+|\s*\/\s*/).map((value) => value.trim()).filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => PERMISSIVE.includes(token))) return "ALLOW";
  return PERMISSIVE.includes(normalized) ? "ALLOW" : "UNKNOWN";
}

interface PnpmDependency { version?: string; path?: string; dependencies?: Record<string, PnpmDependency>; optionalDependencies?: Record<string, PnpmDependency>; }
interface PnpmProject extends PnpmDependency { path?: string; }
interface PackageEvidenceOverride { license: string; source: string; }
interface AssetEvidence { sha256: string; license: string; source: string; }
interface PackageMetadataScan { index: Map<string, { license: string | null; path: string }>; failuresByName: Map<string, string[]>; globalFailures: string[]; }

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}

function assetScanFailure(root: string, path: string, error: unknown): RightsSubject {
  const repositoryPath = relative(root, path);
  return {
    id: `asset-scan:${repositoryPath}`,
    kind: "asset",
    name: repositoryPath,
    versionOrIdentity: "SCAN_FAILED",
    licenseExpression: null,
    state: "UNKNOWN",
    evidence: [repositoryPath, `diagnostic:public-tree:${errorCode(error)}`],
    attributionRequired: false,
    distributed: true
  };
}

function packageMetadataDiagnostic(root: string, path: string, failure: string): string {
  return `diagnostic:package-metadata:${failure}:${relative(root, path)}`;
}

function flattenTree(projects: PnpmProject[]): Map<string, { name: string; version: string; installPath?: string }> {
  const found = new Map<string, { name: string; version: string; installPath?: string }>();
  const visit = (deps: Record<string, PnpmDependency> | undefined) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (dep.version) {
        const id = `${name}@${dep.version}`;
        const previous = found.get(id);
        if (!previous || (!previous.installPath && dep.path)) found.set(id, { name, version: dep.version, ...(dep.path ? { installPath: dep.path } : {}) });
      }
      visit(dep.dependencies); visit(dep.optionalDependencies);
    }
  };
  for (const project of projects) { visit(project.dependencies); visit(project.optionalDependencies); }
  return found;
}

async function packageMetadataIndex(root: string): Promise<PackageMetadataScan> {
  const base = resolve(root, "node_modules/.pnpm");
  const index = new Map<string, { license: string | null; path: string }>();
  const failuresByName = new Map<string, string[]>();
  const globalFailures: string[] = [];
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); }
  catch (error) { return { index, failuresByName, globalFailures: [packageMetadataDiagnostic(root, base, errorCode(error))] }; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const nodeModules = join(base, entry.name, "node_modules");
    let children;
    try { children = await readdir(nodeModules, { withFileTypes: true }); }
    catch (error) { globalFailures.push(packageMetadataDiagnostic(root, nodeModules, errorCode(error))); continue; }
    for (const child of children) {
      if (child.name.startsWith(".")) continue;
      if (child.name.startsWith("@") && child.isDirectory()) {
        const scopeDirectory = join(nodeModules, child.name);
        let scopedEntries;
        try { scopedEntries = await readdir(scopeDirectory, { withFileTypes: true }); }
        catch (error) { globalFailures.push(packageMetadataDiagnostic(root, scopeDirectory, errorCode(error))); continue; }
        for (const scoped of scopedEntries) {
          if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
          await indexPackage(join(nodeModules, child.name, scoped.name), `${child.name}/${scoped.name}`, index, failuresByName, root);
        }
      } else if (child.isDirectory() || child.isSymbolicLink()) await indexPackage(join(nodeModules, child.name), child.name, index, failuresByName, root);
    }
  }
  return { index, failuresByName, globalFailures };
}

async function indexPackage(path: string, expectedName: string, index: Map<string, { license: string | null; path: string }>, failuresByName: Map<string, string[]>, root: string): Promise<void> {
  const manifestPath = join(path, "package.json");
  const recordFailure = (failure: string) => {
    const diagnostics = failuresByName.get(expectedName) ?? [];
    diagnostics.push(packageMetadataDiagnostic(root, manifestPath, failure));
    failuresByName.set(expectedName, diagnostics);
  };
  let source: string;
  try { source = await readFile(manifestPath, "utf8"); }
  catch (error) { recordFailure(errorCode(error)); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(source) as unknown; }
  catch { recordFailure("INVALID_JSON"); return; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { recordFailure("INVALID_MANIFEST"); return; }
  const json = parsed as { name?: unknown; version?: unknown; license?: unknown; licenses?: unknown };
  if (typeof json.version !== "string" || json.version.length === 0 || (json.name !== undefined && json.name !== expectedName) || (json.license !== undefined && typeof json.license !== "string")) { recordFailure("INVALID_MANIFEST"); return; }
  let legacyLicense: string | null = null;
  if (json.licenses !== undefined) {
    if (!Array.isArray(json.licenses) || json.licenses.some((entry) => !entry || typeof entry !== "object" || typeof (entry as { type?: unknown }).type !== "string")) { recordFailure("INVALID_MANIFEST"); return; }
    legacyLicense = json.licenses.map((entry) => (entry as { type: string }).type).join(" OR ") || null;
  }
  const license = typeof json.license === "string" ? json.license : legacyLicense;
  index.set(`${expectedName}@${json.version}`, { license, path: relative(root, manifestPath) });
}

async function loadOverrides(root: string): Promise<Record<string, PackageEvidenceOverride>> {
  try { return JSON.parse(await readFile(resolve(root, "rights-package-evidence.json"), "utf8")) as Record<string, PackageEvidenceOverride>; }
  catch { return {}; }
}

async function loadAssetEvidence(root: string): Promise<Record<string, AssetEvidence>> {
  try { return JSON.parse(await readFile(resolve(root, "rights-asset-evidence.json"), "utf8")) as Record<string, AssetEvidence>; }
  catch { return {}; }
}

export async function scanShippedAssets(root: string): Promise<RightsSubject[]> {
  const publicDir = resolve(root, "apps/site/public");
  const evidenceIndex = await loadAssetEvidence(root);
  const subjects: RightsSubject[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (dir === publicDir && errorCode(error) === "ENOENT") return;
      subjects.push(assetScanFailure(root, dir, error)); return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const repositoryPath = relative(root, path);
        subjects.push({
          id: `asset:${repositoryPath}`,
          kind: "asset",
          name: relative(publicDir, path),
          versionOrIdentity: "SYMLINK_NOT_ADMITTED",
          licenseExpression: null,
          state: "UNKNOWN",
          evidence: [repositoryPath, "diagnostic:public-tree:SYMLINK_NOT_ADMITTED"],
          attributionRequired: false,
          distributed: true
        });
      } else if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const repositoryPath = relative(root, path);
        const declared = evidenceIndex[repositoryPath];
        const contentSha256 = createHash("sha256").update(await readFile(path)).digest("hex");
        const declarationMatches = declared?.sha256 === contentSha256;
        const license = declarationMatches ? declared.license : null;
        const state = declarationMatches ? classifyLicense(license) : "UNKNOWN";
        subjects.push({
          id: `asset:${repositoryPath}`,
          kind: "asset",
          name: relative(publicDir, path),
          versionOrIdentity: contentSha256,
          licenseExpression: license,
          state,
          evidence: [
            repositoryPath,
            declarationMatches ? `rights-asset-evidence.json:${declared.source}` : "rights-asset-evidence.json:ABSENT_OR_HASH_MISMATCH"
          ],
          attributionRequired: state === "ALLOW" && license !== "REPO_ORIGINAL",
          distributed: true
        });
      }
    }
  }
  await walk(publicDir); return subjects;
}

export function applyWaivers(subjects: RightsSubject[], waivers: Waiver[], now: Date): { subjects: RightsSubject[]; expiredWaivers: string[]; diagnostics: string[] } {
  const expiredWaivers: string[] = [];
  const diagnostics: string[] = [];
  if (!Array.isArray(waivers)) return { subjects, expiredWaivers, diagnostics: ["waivers:INVALID_COLLECTION"] };
  const subjectStates = new Map(subjects.map((subject) => [subject.id, subject.state]));
  const bySubject = new Map<string, Waiver>();
  const blockedSubjects = new Set<string>();
  const seenSubjects = new Set<string>();
  for (const [index, candidate] of waivers.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) { diagnostics.push(`waiver:${index}:INVALID_SHAPE`); continue; }
    const waiver = candidate as Waiver;
    const blockKnownSubject = () => {
      if (typeof waiver.subjectId === "string" && subjectStates.has(waiver.subjectId)) {
        blockedSubjects.add(waiver.subjectId);
        bySubject.delete(waiver.subjectId);
      }
    };
    const fields = ["subjectId", "owner", "rationale", "scope", "expiresAt"] as const;
    const emptyField = fields.find((field) => typeof waiver[field] !== "string" || waiver[field].trim().length === 0);
    if (emptyField) { diagnostics.push(`waiver:${index}:${emptyField}:EMPTY`); blockKnownSubject(); continue; }
    if (waiver.scope !== `subject:${waiver.subjectId}`) { diagnostics.push(`waiver:${index}:scope:MISMATCH`); blockKnownSubject(); continue; }
    const expiresAt = Date.parse(waiver.expiresAt);
    if (!Number.isFinite(expiresAt)) { diagnostics.push(`waiver:${index}:expiresAt:INVALID`); blockKnownSubject(); continue; }
    const subjectState = subjectStates.get(waiver.subjectId);
    if (subjectState === undefined) { diagnostics.push(`waiver:${index}:subjectId:UNKNOWN`); continue; }
    if (subjectState !== "REVIEW_REQUIRED") { diagnostics.push(`waiver:${index}:subjectState:${subjectState}`); blockKnownSubject(); continue; }
    if (expiresAt <= now.getTime()) { expiredWaivers.push(waiver.subjectId); blockKnownSubject(); seenSubjects.add(waiver.subjectId); continue; }
    if (seenSubjects.has(waiver.subjectId)) { diagnostics.push(`waiver:${index}:subjectId:DUPLICATE`); blockKnownSubject(); continue; }
    seenSubjects.add(waiver.subjectId);
    if (blockedSubjects.has(waiver.subjectId)) continue;
    bySubject.set(waiver.subjectId, waiver);
  }
  return { subjects: subjects.map((subject) => {
    const waiver = bySubject.get(subject.id); if (!waiver) return subject;
    if (subject.state === "REVIEW_REQUIRED") return { ...subject, state: "ALLOW" as const, evidence: [...subject.evidence, `waiver:${waiver.owner}:${waiver.scope}:${waiver.expiresAt}`] };
    return subject;
  }), expiredWaivers, diagnostics };
}

export async function scanRepositoryRights(root = process.cwd(), waivers: Waiver[] = [], now = new Date()): Promise<RepositoryClearanceReceipt> {
  const { stdout } = await execFileAsync("pnpm", ["-r", "list", "--prod", "--json", "--depth", "Infinity"], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const dependencies = flattenTree(JSON.parse(stdout) as PnpmProject[]);
  const metadata = await packageMetadataIndex(root);
  const overrides = await loadOverrides(root);
  const packageDiagnostics = new Set<string>();
  const packageSubjects: RightsSubject[] = [...dependencies.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)).map(({ name, version, installPath }) => {
    const id = `${name}@${version}`;
    const installed = metadata.index.get(id);
    const override = overrides[id];
    const metadataFailures = metadata.failuresByName.get(name) ?? metadata.globalFailures;
    const installPathTraversal = installPath ? relative(root, installPath) : null;
    const installPathIsInsideRoot = installPathTraversal !== null && installPathTraversal.split(/[\\/]/)[0] !== ".." && !isAbsolute(installPathTraversal);
    if (!installed && installPath && installPathIsInsideRoot && !existsSync(installPath)) {
      return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: override?.license ?? null, state: "NOT_DISTRIBUTED" as const, evidence: [`pnpm production graph:${id}`, "release target package path is absent"], attributionRequired: false, distributed: false };
    }
    if (!installed && installPath && !installPathIsInsideRoot) {
      const diagnostic = `diagnostic:package-path:OUTSIDE_ROOT:${id}`;
      packageDiagnostics.add(diagnostic);
      return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: null, state: "UNKNOWN" as const, evidence: [`pnpm production graph:${id}`, diagnostic], attributionRequired: false, distributed: true };
    }
    if (!installed && metadataFailures.length > 0) {
      for (const diagnostic of metadataFailures) packageDiagnostics.add(diagnostic);
      return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: null, state: "UNKNOWN" as const, evidence: [`pnpm production graph:${id}`, ...metadataFailures], attributionRequired: false, distributed: true };
    }
    if (!installed) return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: override?.license ?? null, state: "NOT_DISTRIBUTED" as const, evidence: [`pnpm production graph:${id}`, "not installed in current release target node_modules"], attributionRequired: false, distributed: false };
    const license = installed.license ?? override?.license ?? null;
    const state = classifyLicense(license);
    return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: license, state, evidence: [installed.path, ...(override ? [override.source] : []), `pnpm production graph:${id}`], attributionRequired: state === "ALLOW", distributed: true };
  });
  const fixedSubjects: RightsSubject[] = [
    { id: "font:system-stack", kind: "font", name: "system font stack", versionOrIdentity: "runtime-system", licenseExpression: null, state: "NOT_DISTRIBUTED", evidence: ["system/fallback font names only; no font binary shipped"], attributionRequired: false, distributed: false },
    { id: "model:internal-deterministic-mock", kind: "model", name: "internal deterministic mock", versionOrIdentity: "internal/v1", licenseExpression: "REPO_ORIGINAL", state: "ALLOW", evidence: ["src/media-router.ts", "deterministic worker fixture"], attributionRequired: false, distributed: true },
    { id: "service:none-required", kind: "service", name: "no mandatory third-party hosted service", versionOrIdentity: "v1-core", licenseExpression: "REPO_POLICY", state: "ALLOW", evidence: ["core runtime operates without third-party hosted service credentials"], attributionRequired: false, distributed: false }
  ];
  const applied = applyWaivers([...packageSubjects, ...await scanShippedAssets(root), ...fixedSubjects], waivers, now);
  const counts = { ALLOW: 0, REVIEW_REQUIRED: 0, DENY: 0, UNKNOWN: 0, NOT_DISTRIBUTED: 0 } satisfies Record<RightsState, number>;
  for (const subject of applied.subjects) counts[subject.state] += 1;
  const unresolved = applied.subjects.filter((subject) => subject.distributed && subject.state !== "ALLOW").map((subject) => subject.id);
  const diagnostics = [...new Set([...packageDiagnostics, ...applied.subjects.flatMap((subject) => subject.evidence.filter((entry) => entry.startsWith("diagnostic:"))), ...applied.diagnostics])];
  return {
    schema: "website-design-compiler/repository-rights-clearance/v2",
    overall: unresolved.length === 0 && applied.expiredWaivers.length === 0 && diagnostics.length === 0 ? "PASS" : "FAIL",
    generatedAt: now.toISOString(), subjects: applied.subjects, counts, unresolved, expiredWaivers: applied.expiredWaivers,
    diagnostics,
    noticeSubjects: applied.subjects.filter((subject) => subject.attributionRequired && subject.distributed).map((subject) => subject.id).sort(),
    legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE"
  };
}
