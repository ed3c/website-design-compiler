import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve, join, relative } from "node:path";

const execFileAsync = promisify(execFile);

export type RightsState = "ALLOW" | "REVIEW_REQUIRED" | "DENY" | "UNKNOWN" | "NOT_DISTRIBUTED";
export interface RightsSubject { id: string; kind: "package" | "asset" | "font" | "model" | "generated-output" | "service"; name: string; versionOrIdentity: string; licenseExpression: string | null; state: RightsState; evidence: string[]; attributionRequired: boolean; distributed: boolean; geographicRestrictions?: string[]; usageRestrictions?: string[]; }
export interface Waiver { subjectId: string; owner: string; rationale: string; scope: string; expiresAt: string; }
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
    if (!entry.isDirectory()) continue;
    const nodeModules = join(base, entry.name, "node_modules");
    let children;
    try { children = await readdir(nodeModules, { withFileTypes: true }); } catch { continue; }
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
  try {
    const json = JSON.parse(await readFile(join(path, "package.json"), "utf8")) as { name?: string; version?: string; license?: string; licenses?: Array<{ type?: string }> };
    if (!json.version) return;
    const name = json.name ?? expectedName;
    const license = json.license ?? json.licenses?.map((entry) => entry.type).filter(Boolean).join(" OR ") ?? null;
    index.set(`${name}@${json.version}`, { license, path: relative(root, join(path, "package.json")) });
  } catch {}
}

async function loadOverrides(root: string): Promise<Record<string, PackageEvidenceOverride>> {
  try { return JSON.parse(await readFile(resolve(root, "rights-package-evidence.json"), "utf8")) as Record<string, PackageEvidenceOverride>; }
  catch { return {}; }
}

async function shippedAssets(root: string): Promise<RightsSubject[]> {
  const publicDir = resolve(root, "apps/site/public");
  const subjects: RightsSubject[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) subjects.push({ id: `asset:${relative(root, path)}`, kind: "asset", name: relative(publicDir, path), versionOrIdentity: relative(root, path), licenseExpression: "REPO_ORIGINAL", state: "ALLOW", evidence: [relative(root, path), "repository-owned static asset declaration"], attributionRequired: false, distributed: true });
    }
  }
  await walk(publicDir); return subjects;
}

export function applyWaivers(subjects: RightsSubject[], waivers: Waiver[], now: Date): { subjects: RightsSubject[]; expiredWaivers: string[] } {
  const expiredWaivers: string[] = [];
  const bySubject = new Map(waivers.map((waiver) => [waiver.subjectId, waiver]));
  return { subjects: subjects.map((subject) => {
    const waiver = bySubject.get(subject.id); if (!waiver) return subject;
    if (new Date(waiver.expiresAt).getTime() <= now.getTime()) { expiredWaivers.push(subject.id); return subject; }
    if (subject.state === "REVIEW_REQUIRED") return { ...subject, state: "ALLOW" as const, evidence: [...subject.evidence, `waiver:${waiver.owner}:${waiver.scope}:${waiver.expiresAt}`] };
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
  const applied = applyWaivers([...packageSubjects, ...await shippedAssets(root), ...fixedSubjects], waivers, now);
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
