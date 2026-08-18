import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve, join, relative } from "node:path";

const execFileAsync = promisify(execFile);

export type RightsState = "ALLOW" | "REVIEW_REQUIRED" | "DENY" | "UNKNOWN" | "NOT_DISTRIBUTED";
export interface RightsSubject { id: string; kind: "package" | "asset" | "font" | "model" | "generated-output" | "service"; name: string; versionOrIdentity: string; licenseExpression: string | null; state: RightsState; evidence: string[]; attributionRequired: boolean; distributed: boolean; geographicRestrictions?: string[]; usageRestrictions?: string[]; }
export interface Waiver { subjectId: string; owner: string; rationale: string; scope: string; expiresAt: string; }
export interface AssetProvenanceEntry { path: string; sha256: string; licenseExpression: string; provenance: { kind: "AUTHORED" | "LICENSED" | "PUBLIC_DOMAIN"; source: string }; attributionRequired: boolean; }
export interface AssetProvenanceManifest { schema: "website-design-compiler/asset-provenance/v1"; assets: AssetProvenanceEntry[]; }
export interface RepositoryClearanceReceipt { schema: "website-design-compiler/repository-rights-clearance/v2"; overall: "PASS" | "FAIL"; generatedAt: string; subjects: RightsSubject[]; counts: Record<RightsState, number>; unresolved: string[]; expiredWaivers: string[]; noticeSubjects: string[]; legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE"; }

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

interface PnpmDependency { version?: string; dependencies?: Record<string, PnpmDependency>; optionalDependencies?: Record<string, PnpmDependency>; }
interface PnpmProject extends PnpmDependency { path?: string; }
interface PackageEvidenceOverride { license: string; source: string; }

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readJsonFile(path: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`unable to read rights input ${path}`, { cause: error });
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`invalid JSON in rights input ${path}`, { cause: error });
  }
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

export function validateWaivers(value: unknown): Waiver[] {
  if (!Array.isArray(value)) throw new Error("rights waivers must be an array");
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`rights waiver ${index} must be an object`);
    const waiver = candidate as Record<string, unknown>;
    if (!exactKeys(waiver, ["subjectId", "owner", "rationale", "scope", "expiresAt"])) throw new Error(`rights waiver ${index} has unknown or missing fields`);
    if (typeof waiver.subjectId !== "string" || !/^(?:package|asset|font|model|generated-output|service):[^\s]{1,240}$/.test(waiver.subjectId)) throw new Error(`rights waiver ${index} subjectId is invalid`);
    if (seen.has(waiver.subjectId)) throw new Error(`rights waiver ${index} duplicates ${waiver.subjectId}`);
    seen.add(waiver.subjectId);
    if (typeof waiver.owner !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._@/-]{2,127}$/.test(waiver.owner)) throw new Error(`rights waiver ${index} owner is invalid`);
    if (typeof waiver.rationale !== "string" || waiver.rationale.trim() !== waiver.rationale || waiver.rationale.length < 12 || waiver.rationale.length > 500 || /[\r\n\0]/.test(waiver.rationale)) throw new Error(`rights waiver ${index} rationale is invalid`);
    if (waiver.scope !== `subject:${waiver.subjectId}`) throw new Error(`rights waiver ${index} scope must bind its exact subject`);
    if (typeof waiver.expiresAt !== "string" || !Number.isFinite(Date.parse(waiver.expiresAt)) || new Date(waiver.expiresAt).toISOString() !== waiver.expiresAt) throw new Error(`rights waiver ${index} expiresAt must be canonical ISO date-time`);
    return waiver as unknown as Waiver;
  });
}

export async function loadWaivers(path: string): Promise<Waiver[]> {
  try {
    return validateWaivers(await readJsonFile(path));
  } catch (error) {
    if (isEnoent(error instanceof Error && "cause" in error ? error.cause : error)) return [];
    throw error;
  }
}

function flattenTree(projects: PnpmProject[]): Map<string, { name: string; version: string }> {
  const found = new Map<string, { name: string; version: string }>();
  const visit = (deps: Record<string, PnpmDependency> | undefined) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (dep.version) found.set(`${name}@${dep.version}`, { name, version: dep.version });
      visit(dep.dependencies); visit(dep.optionalDependencies);
    }
  };
  for (const project of projects) { visit(project.dependencies); visit(project.optionalDependencies); }
  return found;
}

async function packageMetadataIndex(root: string): Promise<Map<string, { license: string | null; path: string }>> {
  const base = resolve(root, "node_modules/.pnpm");
  const index = new Map<string, { license: string | null; path: string }>();
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const nodeModules = join(base, entry.name, "node_modules");
    const children = await readdir(nodeModules, { withFileTypes: true });
    for (const child of children) {
      if (child.name.startsWith(".")) continue;
      if (child.name.startsWith("@") && child.isDirectory()) {
        for (const scoped of await readdir(join(nodeModules, child.name), { withFileTypes: true })) {
          if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
          await indexPackage(join(nodeModules, child.name, scoped.name), `${child.name}/${scoped.name}`, index, root);
        }
      } else if (child.isDirectory() || child.isSymbolicLink()) await indexPackage(join(nodeModules, child.name), child.name, index, root);
    }
  }
  return index;
}

async function indexPackage(path: string, expectedName: string, index: Map<string, { license: string | null; path: string }>, root: string): Promise<void> {
  const manifestPath = join(path, "package.json");
  const raw = await readJsonFile(manifestPath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`package manifest ${manifestPath} must be an object`);
  const json = raw as { name?: unknown; version?: unknown; license?: unknown; licenses?: unknown };
  if (typeof json.version !== "string" || json.version.length === 0) throw new Error(`package manifest ${manifestPath} has no version`);
  if (json.name !== undefined && typeof json.name !== "string") throw new Error(`package manifest ${manifestPath} has invalid name`);
  if (json.license !== undefined && typeof json.license !== "string") throw new Error(`package manifest ${manifestPath} has invalid license`);
  if (json.licenses !== undefined && !Array.isArray(json.licenses)) throw new Error(`package manifest ${manifestPath} has invalid licenses`);
  const legacyLicenses = Array.isArray(json.licenses)
    ? json.licenses.map((entry) => {
      if (!entry || typeof entry !== "object" || typeof (entry as { type?: unknown }).type !== "string") throw new Error(`package manifest ${manifestPath} has invalid legacy license entry`);
      return (entry as { type: string }).type;
    }).join(" OR ")
    : undefined;
  const name = typeof json.name === "string" ? json.name : expectedName;
  const license = typeof json.license === "string" ? json.license : legacyLicenses ?? null;
  index.set(`${name}@${json.version}`, { license, path: relative(root, manifestPath) });
}

async function loadOverrides(root: string): Promise<Record<string, PackageEvidenceOverride>> {
  const path = resolve(root, "rights-package-evidence.json");
  let raw: unknown;
  try { raw = await readJsonFile(path); }
  catch (error) {
    if (isEnoent(error instanceof Error && "cause" in error ? error.cause : error)) return {};
    throw error;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("rights package evidence must be an object");
  const overrides: Record<string, PackageEvidenceOverride> = {};
  for (const [id, candidate] of Object.entries(raw)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !exactKeys(candidate as Record<string, unknown>, ["license", "source"])) throw new Error(`rights package evidence ${id} is invalid`);
    const { license, source } = candidate as Record<string, unknown>;
    if (typeof license !== "string" || license.trim().length === 0 || typeof source !== "string" || source.trim().length === 0) throw new Error(`rights package evidence ${id} requires license and source`);
    overrides[id] = { license, source };
  }
  return overrides;
}

export async function scanShippedAssets(root: string): Promise<RightsSubject[]> {
  const publicDir = resolve(root, "apps/site/public");
  const actualPaths: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (dir === publicDir && isEnoent(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) actualPaths.push(relative(root, path));
    }
  }
  await walk(publicDir);
  const manifestPath = resolve(root, "rights-asset-provenance.json");
  const raw = await readJsonFile(manifestPath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("asset provenance manifest must be an object");
  const manifest = raw as Partial<AssetProvenanceManifest> & Record<string, unknown>;
  if (!exactKeys(manifest, ["schema", "assets"]) || manifest.schema !== "website-design-compiler/asset-provenance/v1" || !Array.isArray(manifest.assets)) throw new Error("asset provenance manifest contract is invalid");
  const byPath = new Map<string, AssetProvenanceEntry>();
  for (const [index, candidate] of manifest.assets.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !exactKeys(candidate as unknown as Record<string, unknown>, ["path", "sha256", "licenseExpression", "provenance", "attributionRequired"])) throw new Error(`asset provenance entry ${index} is invalid`);
    const entry = candidate as AssetProvenanceEntry;
    if (!/^apps\/site\/public\/[A-Za-z0-9._/-]+$/.test(entry.path) || entry.path.includes("..")) throw new Error(`asset provenance entry ${index} path is invalid`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`asset provenance entry ${index} sha256 is invalid`);
    if (entry.licenseExpression === "REPO_ORIGINAL" || classifyLicense(entry.licenseExpression) === "UNKNOWN") throw new Error(`asset provenance entry ${index} license is not governable evidence`);
    if (!entry.provenance || typeof entry.provenance !== "object" || !exactKeys(entry.provenance as unknown as Record<string, unknown>, ["kind", "source"]) || !["AUTHORED", "LICENSED", "PUBLIC_DOMAIN"].includes(entry.provenance.kind) || typeof entry.provenance.source !== "string") throw new Error(`asset provenance entry ${index} provenance is invalid`);
    const authoredSource = /^git:[a-f0-9]{40}:[A-Za-z0-9._/-]+$/.test(entry.provenance.source);
    const externalSource = /^https:\/\/[^\s?#]+(?:\/[^\s?#]*)?#sha256=[a-f0-9]{64}$/.test(entry.provenance.source);
    if ((entry.provenance.kind === "AUTHORED" && !authoredSource) || (entry.provenance.kind !== "AUTHORED" && !externalSource)) throw new Error(`asset provenance entry ${index} source is not immutable`);
    if (typeof entry.attributionRequired !== "boolean") throw new Error(`asset provenance entry ${index} attributionRequired is invalid`);
    if (byPath.has(entry.path)) throw new Error(`asset provenance entry duplicates ${entry.path}`);
    byPath.set(entry.path, entry);
  }
  const actualSet = new Set(actualPaths);
  const missingEvidence = actualPaths.filter((path) => !byPath.has(path));
  const missingAsset = [...byPath.keys()].filter((path) => !actualSet.has(path));
  if (missingEvidence.length > 0 || missingAsset.length > 0) throw new Error(`asset provenance coverage mismatch: missingEvidence=${missingEvidence.join(",") || "none"}; missingAsset=${missingAsset.join(",") || "none"}`);
  const subjects: RightsSubject[] = [];
  for (const path of actualPaths.sort()) {
    const entry = byPath.get(path)!;
    const actualSha256 = createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
    if (actualSha256 !== entry.sha256) throw new Error(`asset provenance digest mismatch for ${path}`);
    const state = classifyLicense(entry.licenseExpression);
    subjects.push({id:`asset:${path}`,kind:"asset",name:relative(publicDir,resolve(root,path)),versionOrIdentity:`sha256:${actualSha256}`,licenseExpression:entry.licenseExpression,state,evidence:["rights-asset-provenance.json",entry.provenance.source,`sha256:${actualSha256}`],attributionRequired:entry.attributionRequired,distributed:true});
  }
  return subjects;
}

export function applyWaivers(subjects: RightsSubject[], waivers: Waiver[], now: Date): { subjects: RightsSubject[]; expiredWaivers: string[] } {
  const validatedWaivers = validateWaivers(waivers);
  const expiredWaivers: string[] = [];
  const subjectStates = new Map(subjects.map((subject) => [subject.id, subject.state]));
  for (const waiver of validatedWaivers) {
    const state = subjectStates.get(waiver.subjectId);
    if (state === undefined) throw new Error(`rights waiver references unknown subject ${waiver.subjectId}`);
    if (state !== "REVIEW_REQUIRED") throw new Error(`rights waiver may only admit REVIEW_REQUIRED subject ${waiver.subjectId}`);
  }
  const bySubject = new Map(validatedWaivers.map((waiver) => [waiver.subjectId, waiver]));
  return { subjects: subjects.map((subject) => {
    const waiver = bySubject.get(subject.id); if (!waiver) return subject;
    if (new Date(waiver.expiresAt).getTime() <= now.getTime()) { expiredWaivers.push(subject.id); return subject; }
    if (subject.state === "REVIEW_REQUIRED") return { ...subject, state: "ALLOW" as const, evidence: [...subject.evidence, `waiver:${waiver.owner}:${waiver.scope}:${waiver.expiresAt}:${waiver.rationale}`] };
    return subject;
  }), expiredWaivers };
}

export async function scanRepositoryRights(root = process.cwd(), waivers: Waiver[] = [], now = new Date()): Promise<RepositoryClearanceReceipt> {
  const { stdout } = await execFileAsync("pnpm", ["list", "--prod", "--json", "--depth", "Infinity"], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const dependencies = flattenTree(JSON.parse(stdout) as PnpmProject[]);
  const metadata = await packageMetadataIndex(root);
  const overrides = await loadOverrides(root);
  const packageSubjects: RightsSubject[] = [...dependencies.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)).map(({ name, version }) => {
    const id = `${name}@${version}`;
    const installed = metadata.get(id);
    const override = overrides[id];
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
  return {
    schema: "website-design-compiler/repository-rights-clearance/v2",
    overall: unresolved.length === 0 && applied.expiredWaivers.length === 0 ? "PASS" : "FAIL",
    generatedAt: now.toISOString(), subjects: applied.subjects, counts, unresolved, expiredWaivers: applied.expiredWaivers,
    noticeSubjects: applied.subjects.filter((subject) => subject.attributionRequired && subject.distributed).map((subject) => subject.id).sort(),
    legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE"
  };
}
