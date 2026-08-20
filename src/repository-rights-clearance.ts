import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { isAbsolute, resolve, join, relative } from "node:path";

const execFileAsync = promisify(execFile);

export type RightsState = "ALLOW" | "REVIEW_REQUIRED" | "DENY" | "UNKNOWN" | "NOT_DISTRIBUTED";
export interface RightsSubject { id: string; kind: "package" | "asset" | "font" | "model" | "generated-output" | "service"; name: string; versionOrIdentity: string; licenseExpression: string | null; state: RightsState; evidence: string[]; attributionRequired: boolean; distributed: boolean; geographicRestrictions?: string[]; usageRestrictions?: string[]; }
export interface Waiver { subjectId: string; owner: string; rationale: string; scope: string; expiresAt: string; }
export interface RepositoryClearanceReceipt { schema: "website-design-compiler/repository-rights-clearance/v2"; overall: "PASS" | "FAIL"; generatedAt: string; subjects: RightsSubject[]; counts: Record<RightsState, number>; unresolved: string[]; expiredWaivers: string[]; diagnostics: string[]; noticeSubjects: string[]; legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE"; }

const PERMISSIVE = ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Unlicense", "CC0-1.0", "BlueOak-1.0.0", "Python-2.0", "WTFPL"];
const REVIEW_MARKERS = ["MPL", "EPL", "LGPL", "GPL", "AGPL", "CDDL", "OSL", "Artistic", "CC-BY", "gsap.com/standard-license"];
const DENY_MARKERS = ["NON-COMMERCIAL", "NONCOMMERCIAL", "NC-", "Commons-Clause", "PolyForm-Noncommercial"];
const RIGHTS_STATES = ["ALLOW", "REVIEW_REQUIRED", "DENY", "UNKNOWN", "NOT_DISTRIBUTED"] as const;
const SUBJECT_KINDS = ["package", "asset", "font", "model", "generated-output", "service"] as const;

export function classifyLicense(expression: string | null): RightsState {
  if (!expression || expression.trim() === "" || expression === "NOASSERTION") return "UNKNOWN";
  const normalized = expression.replace(/[()]/g, " ").trim();
  if (DENY_MARKERS.some((marker) => normalized.toLowerCase().includes(marker.toLowerCase()))) return "DENY";
  if (REVIEW_MARKERS.some((marker) => normalized.includes(marker))) return "REVIEW_REQUIRED";
  const tokens = normalized.split(/\s+(?:OR|AND|WITH)\s+|\s*\/\s*/).map((value) => value.trim()).filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => PERMISSIVE.includes(token))) return "ALLOW";
  return PERMISSIVE.includes(normalized) ? "ALLOW" : "UNKNOWN";
}

export function classifyProductionRightsEvidence(expression: string): RightsState {
  const classified = classifyLicense(expression);
  if (classified === "DENY" || expression === "NOASSERTION") return classified;
  return "REVIEW_REQUIRED";
}

interface PnpmDependency { version?: string; path?: string; dependencies?: Record<string, PnpmDependency>; optionalDependencies?: Record<string, PnpmDependency>; }
interface PnpmProject extends PnpmDependency { path?: string; }
interface PackageEvidenceOverride { license: string; source: string; }
export interface AssetProvenanceEntry { path: string; sha256: string; licenseExpression: string; provenance: { kind: "AUTHORED" | "LICENSED" | "PUBLIC_DOMAIN"; source: string }; attributionRequired: boolean; }
export interface AssetProvenanceManifest { schema: "website-design-compiler/asset-provenance/v1"; assets: AssetProvenanceEntry[]; }
interface ProductionRightsEvidenceSource { url: string; sha256: string; bytes: number; verifiedAt: string; }
interface ProductionRightsEvidenceSubject { id: string; kind: "model" | "generated-output" | "service"; name: string; sourceRevision: string; versionOrIdentity: string; licenseExpression: string; evidence: ProductionRightsEvidenceSource[]; attributionRequired: boolean; distributed: boolean; geographicRestrictions: string[]; usageRestrictions: string[]; }
interface PackageMetadataScan { index: Map<string, { license: string | null; path: string }>; failuresByName: Map<string, string[]>; globalFailures: string[]; }
type ExactPackageMetadata = { license: string | null; path: string } | { diagnostic: string };

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown, allowEmpty = true): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function sameStringMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && [...actual].sort().every((entry, index) => entry === [...expected].sort()[index]);
}

export function validateRepositoryClearanceReceipt(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["rights receipt must be an object"];
  if (value.schema !== "website-design-compiler/repository-rights-clearance/v2") errors.push("schema is invalid");
  if (value.overall !== "PASS" && value.overall !== "FAIL") errors.push("overall must be PASS or FAIL");
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt)) || new Date(value.generatedAt).toISOString() !== value.generatedAt) errors.push("generatedAt must be an exact ISO timestamp");
  if (value.legalDisclaimer !== "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE") errors.push("legalDisclaimer is invalid");

  const counts = Object.fromEntries(RIGHTS_STATES.map((state) => [state, 0])) as Record<RightsState, number>;
  const unresolved: string[] = [];
  const notices: string[] = [];
  const subjectIds = new Set<string>();
  if (!Array.isArray(value.subjects) || value.subjects.length === 0) errors.push("subjects must be a non-empty array");
  for (const [index, candidate] of (Array.isArray(value.subjects) ? value.subjects : []).entries()) {
    if (!isRecord(candidate)) { errors.push(`subjects[${index}] must be an object`); continue; }
    const id = typeof candidate.id === "string" && candidate.id.trim().length > 0 ? candidate.id : null;
    const state = RIGHTS_STATES.includes(candidate.state as RightsState) ? candidate.state as RightsState : null;
    if (!id || typeof candidate.name !== "string" || candidate.name.trim().length === 0 || typeof candidate.versionOrIdentity !== "string" || candidate.versionOrIdentity.trim().length === 0 || !SUBJECT_KINDS.includes(candidate.kind as RightsSubject["kind"]) || !state || (candidate.licenseExpression !== null && typeof candidate.licenseExpression !== "string") || !stringArray(candidate.evidence, false) || typeof candidate.attributionRequired !== "boolean" || typeof candidate.distributed !== "boolean") {
      errors.push(`subjects[${index}] is malformed`);
      continue;
    }
    if (subjectIds.has(id)) errors.push(`subjects contains duplicate id ${id}`);
    subjectIds.add(id);
    if (candidate.geographicRestrictions !== undefined && !stringArray(candidate.geographicRestrictions)) errors.push(`subjects[${index}].geographicRestrictions is malformed`);
    if (candidate.usageRestrictions !== undefined && !stringArray(candidate.usageRestrictions)) errors.push(`subjects[${index}].usageRestrictions is malformed`);
    if (state === "NOT_DISTRIBUTED" && candidate.distributed) errors.push(`subjects[${index}] cannot distribute a NOT_DISTRIBUTED subject`);
    counts[state] += 1;
    if (candidate.distributed && state !== "ALLOW") unresolved.push(id);
    if (candidate.distributed && candidate.attributionRequired) notices.push(id);
  }

  if (!isRecord(value.counts) || !exactKeys(value.counts, RIGHTS_STATES)) errors.push("counts must contain exactly the rights states");
  else for (const state of RIGHTS_STATES) if (!Number.isInteger(value.counts[state]) || value.counts[state] !== counts[state]) errors.push(`counts.${state} is inconsistent; expected ${counts[state]}`);

  const listFields = ["unresolved", "expiredWaivers", "diagnostics", "noticeSubjects"] as const;
  for (const field of listFields) if (!stringArray(value[field])) errors.push(`${field} must be a string array`);
  const declaredUnresolved = stringArray(value.unresolved) ? value.unresolved : [];
  const expiredWaivers = stringArray(value.expiredWaivers) ? value.expiredWaivers : [];
  const diagnostics = stringArray(value.diagnostics) ? value.diagnostics : [];
  const declaredNotices = stringArray(value.noticeSubjects) ? value.noticeSubjects : [];
  for (const [field, entries] of [["unresolved", declaredUnresolved], ["expiredWaivers", expiredWaivers], ["diagnostics", diagnostics], ["noticeSubjects", declaredNotices]] as const) {
    if (new Set(entries).size !== entries.length) errors.push(`${field} must not contain duplicates`);
  }
  if (!sameStringMembers(declaredUnresolved, unresolved)) errors.push("unresolved is inconsistent with distributed subjects");
  if (!sameStringMembers(declaredNotices, notices)) errors.push("noticeSubjects is inconsistent with attributable subjects");
  for (const id of expiredWaivers) if (!subjectIds.has(id)) errors.push(`expired waiver subject ${id} is absent`);
  const expectedOverall = unresolved.length === 0 && expiredWaivers.length === 0 && diagnostics.length === 0 && errors.length === 0 ? "PASS" : "FAIL";
  if (value.overall !== expectedOverall) errors.push(`overall is inconsistent with rights semantics; expected ${expectedOverall}`);
  return errors;
}

function parseWaivers(source: string): Waiver[] {
  let value: unknown;
  try { value = JSON.parse(source) as unknown; }
  catch { throw new Error("rights waivers contain invalid JSON"); }
  if (!Array.isArray(value)) throw new Error("rights waivers must be an array");
  return value as Waiver[];
}

export async function loadWaivers(path: string): Promise<Waiver[]> {
  let source: string;
  try { source = await readFile(path, "utf8"); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw new Error(`unable to read rights waivers: ${errorCode(error)}`);
  }
  return parseWaivers(source);
}

export async function loadTrustedWaivers(path: string, trustedSha256?: string): Promise<Waiver[]> {
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch (error) {
    if (errorCode(error) === "ENOENT") {
      if (trustedSha256) throw new Error("externally trusted rights waiver SHA-256 is configured but the waiver file is absent");
      return [];
    }
    throw new Error(`unable to read rights waivers: ${errorCode(error)}`);
  }
  const waivers = parseWaivers(bytes.toString("utf8"));
  if (waivers.length === 0 && !trustedSha256) return waivers;
  if (!trustedSha256) throw new Error("rights waiver externally trusted SHA-256 is absent");
  if (!/^[a-f0-9]{64}$/.test(trustedSha256)) throw new Error("rights waiver externally trusted SHA-256 is malformed");
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== trustedSha256) throw new Error("rights waiver file does not match the externally trusted SHA-256");
  return waivers;
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

async function packageMetadataAtInstallPath(root: string, installPath: string, expectedName: string, expectedVersion: string): Promise<ExactPackageMetadata> {
  const repositoryPath = relative(root, installPath);
  let canonicalRoot: string;
  let canonicalPath: string;
  try {
    canonicalRoot = await realpath(root);
    canonicalPath = await realpath(installPath);
  }
  catch (error) { return { diagnostic: packageMetadataDiagnostic(root, join(installPath, "package.json"), errorCode(error)) }; }
  const canonicalTraversal = relative(canonicalRoot, canonicalPath);
  if (canonicalTraversal.split(/[\\/]/)[0] === ".." || isAbsolute(canonicalTraversal)) {
    return { diagnostic: `diagnostic:package-path:OUTSIDE_ROOT:${expectedName}@${expectedVersion}` };
  }
  const manifestPath = join(canonicalPath, "package.json");
  let source: string;
  try { source = await readFile(manifestPath, "utf8"); }
  catch (error) { return { diagnostic: packageMetadataDiagnostic(root, join(installPath, "package.json"), errorCode(error)) }; }
  let parsed: unknown;
  try { parsed = JSON.parse(source) as unknown; }
  catch { return { diagnostic: packageMetadataDiagnostic(root, join(installPath, "package.json"), "INVALID_JSON") }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { diagnostic: packageMetadataDiagnostic(root, join(installPath, "package.json"), "INVALID_MANIFEST") };
  }
  const json = parsed as { name?: unknown; version?: unknown; license?: unknown; licenses?: unknown };
  if (json.name !== expectedName || json.version !== expectedVersion || (json.license !== undefined && typeof json.license !== "string")) {
    return { diagnostic: packageMetadataDiagnostic(root, join(installPath, "package.json"), "IDENTITY_MISMATCH") };
  }
  let legacyLicense: string | null = null;
  if (json.licenses !== undefined) {
    if (!Array.isArray(json.licenses) || json.licenses.some((entry) => !entry || typeof entry !== "object" || typeof (entry as { type?: unknown }).type !== "string")) {
      return { diagnostic: packageMetadataDiagnostic(root, join(installPath, "package.json"), "INVALID_MANIFEST") };
    }
    legacyLicense = json.licenses.map((entry) => (entry as { type: string }).type).join(" OR ") || null;
  }
  return { license: typeof json.license === "string" ? json.license : legacyLicense, path: `${repositoryPath}/package.json` };
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

async function loadOverrides(root: string): Promise<{ entries: Record<string, PackageEvidenceOverride>; diagnostic?: string }> {
  const path = resolve(root, "rights-package-evidence.json");
  let source: string;
  try { source = await readFile(path, "utf8"); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return { entries: {} };
    return { entries: {}, diagnostic: `diagnostic:package-evidence:${errorCode(error)}` };
  }
  let value: unknown;
  try { value = JSON.parse(source) as unknown; }
  catch { return { entries: {}, diagnostic: "diagnostic:package-evidence:INVALID_JSON" }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { entries: {}, diagnostic: "diagnostic:package-evidence:INVALID_MANIFEST" };
  }
  const entries = value as Record<string, unknown>;
  for (const [id, candidate] of Object.entries(entries)) {
    if (!/^@?[A-Za-z0-9._/-]+@[^\s]+$/.test(id) || !candidate || typeof candidate !== "object" || Array.isArray(candidate) || !exactKeys(candidate as Record<string, unknown>, ["license", "source"])) {
      return { entries: {}, diagnostic: "diagnostic:package-evidence:INVALID_MANIFEST" };
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.license !== "string" || record.license.trim().length === 0 || typeof record.source !== "string" || record.source.trim().length === 0) {
      return { entries: {}, diagnostic: "diagnostic:package-evidence:INVALID_MANIFEST" };
    }
  }
  return { entries: entries as Record<string, PackageEvidenceOverride> };
}

async function loadAssetEvidence(root: string): Promise<{ entries: Map<string, AssetProvenanceEntry>; diagnostic?: string }> {
  const path = resolve(root, "rights-asset-provenance.json");
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch (error) { return { entries: new Map(), diagnostic: `diagnostic:asset-provenance:${errorCode(error)}` }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !exactKeys(raw as Record<string, unknown>, ["schema", "assets"])) {
    return { entries: new Map(), diagnostic: "diagnostic:asset-provenance:INVALID_MANIFEST" };
  }
  const manifest = raw as Partial<AssetProvenanceManifest>;
  if (manifest.schema !== "website-design-compiler/asset-provenance/v1" || !Array.isArray(manifest.assets)) {
    return { entries: new Map(), diagnostic: "diagnostic:asset-provenance:INVALID_MANIFEST" };
  }
  const entries = new Map<string, AssetProvenanceEntry>();
  for (const [index, candidate] of manifest.assets.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !exactKeys(candidate as unknown as Record<string, unknown>, ["path", "sha256", "licenseExpression", "provenance", "attributionRequired"])) {
      return { entries: new Map(), diagnostic: `diagnostic:asset-provenance:ENTRY_${index}_INVALID` };
    }
    const entry = candidate as AssetProvenanceEntry;
    const provenance = entry.provenance;
    const authoredSource = provenance?.kind === "AUTHORED" && /^git:[a-f0-9]{40}:[A-Za-z0-9._/-]+$/.test(provenance.source);
    const externalSource = (provenance?.kind === "LICENSED" || provenance?.kind === "PUBLIC_DOMAIN") && /^https:\/\/[^\s?#]+(?:\/[^\s?#]*)?#sha256=[a-f0-9]{64}$/.test(provenance.source);
    if (!/^apps\/site\/public\/[A-Za-z0-9._/-]+$/.test(entry.path) || entry.path.includes("..") || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.licenseExpression !== "string" || classifyLicense(entry.licenseExpression) === "UNKNOWN" || (!authoredSource && !externalSource) || typeof entry.attributionRequired !== "boolean" || entries.has(entry.path)) {
      return { entries: new Map(), diagnostic: `diagnostic:asset-provenance:ENTRY_${index}_INVALID` };
    }
    entries.set(entry.path, entry);
  }
  return { entries };
}

async function loadProductionRightsEvidence(root: string): Promise<{ subjects: RightsSubject[]; diagnostic?: string }> {
  const path = resolve(root, "rights-production-evidence.json");
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch (error) {
    if (errorCode(error) === "ENOENT") return { subjects: [] };
    return { subjects: [], diagnostic: `diagnostic:production-rights:${errorCode(error) === "UNKNOWN" ? "INVALID_JSON" : errorCode(error)}` };
  }
  if (!isRecord(value) || !exactKeys(value, ["schema", "subjects"]) || value.schema !== "website-design-compiler/production-rights-evidence/v2" || !Array.isArray(value.subjects) || value.subjects.length === 0) {
    return { subjects: [], diagnostic: "diagnostic:production-rights:INVALID_MANIFEST" };
  }
  const subjects: RightsSubject[] = [];
  const ids = new Set<string>();
  for (const candidate of value.subjects) {
    if (!isRecord(candidate) || !exactKeys(candidate, ["id", "kind", "name", "sourceRevision", "versionOrIdentity", "licenseExpression", "evidence", "attributionRequired", "distributed", "geographicRestrictions", "usageRestrictions"])) {
      return { subjects: [], diagnostic: "diagnostic:production-rights:INVALID_MANIFEST" };
    }
    const subject = candidate as unknown as ProductionRightsEvidenceSubject;
    const expectedPrefix = `${subject.kind}:`;
    if (!["model", "generated-output", "service"].includes(subject.kind) || typeof subject.id !== "string" || !subject.id.startsWith(expectedPrefix) || !/^[A-Za-z0-9][A-Za-z0-9._:@/+,-]{0,511}$/.test(subject.id) || ids.has(subject.id) || typeof subject.name !== "string" || subject.name.trim().length === 0 || typeof subject.sourceRevision !== "string" || !/^[a-f0-9]{40}$/.test(subject.sourceRevision) || typeof subject.versionOrIdentity !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/+,-]{0,511}$/.test(subject.versionOrIdentity) || typeof subject.licenseExpression !== "string" || subject.licenseExpression.trim().length === 0 || typeof subject.attributionRequired !== "boolean" || typeof subject.distributed !== "boolean" || !stringArray(subject.geographicRestrictions) || !stringArray(subject.usageRestrictions) || !Array.isArray(subject.evidence) || subject.evidence.length === 0) {
      return { subjects: [], diagnostic: "diagnostic:production-rights:INVALID_MANIFEST" };
    }
    const evidence: string[] = ["rights-production-evidence.json"];
    for (const source of subject.evidence) {
      if (!isRecord(source) || !exactKeys(source, ["url", "sha256", "bytes", "verifiedAt"]) || typeof source.url !== "string" || !/^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/.test(source.url) || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isInteger(source.bytes) || source.bytes <= 0 || typeof source.verifiedAt !== "string" || Number.isNaN(Date.parse(source.verifiedAt)) || new Date(source.verifiedAt).toISOString() !== source.verifiedAt) {
        return { subjects: [], diagnostic: "diagnostic:production-rights:INVALID_MANIFEST" };
      }
      evidence.push(`${source.url}#sha256=${source.sha256}`, `bytes:${source.bytes}`, `verified-at:${source.verifiedAt}`);
    }
    ids.add(subject.id);
    const classified = classifyProductionRightsEvidence(subject.licenseExpression);
    subjects.push({
      id: subject.id,
      kind: subject.kind,
      name: subject.name,
      versionOrIdentity: subject.versionOrIdentity,
      licenseExpression: subject.licenseExpression,
      state: classified,
      evidence,
      attributionRequired: subject.attributionRequired,
      distributed: subject.distributed,
      geographicRestrictions: subject.geographicRestrictions,
      usageRestrictions: subject.usageRestrictions
    });
  }
  return { subjects };
}

export async function scanShippedAssets(root: string): Promise<RightsSubject[]> {
  const publicDir = resolve(root, "apps/site/public");
  try { await lstat(publicDir); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    return [assetScanFailure(root, publicDir, error)];
  }
  const evidence = await loadAssetEvidence(root);
  const evidenceIndex = evidence.entries;
  const subjects: RightsSubject[] = [];
  if (evidence.diagnostic) {
    subjects.push({ id: "asset-scan:rights-asset-provenance.json", kind: "asset", name: "rights-asset-provenance.json", versionOrIdentity: "INVALID", licenseExpression: null, state: "UNKNOWN", evidence: [evidence.diagnostic], attributionRequired: false, distributed: true });
  }
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
        const declared = evidenceIndex.get(repositoryPath);
        const contentSha256 = createHash("sha256").update(await readFile(path)).digest("hex");
        const declarationMatches = declared?.sha256 === contentSha256;
        const license = declarationMatches ? declared.licenseExpression : null;
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
            declarationMatches ? "rights-asset-provenance.json" : "rights-asset-provenance.json:ABSENT_OR_HASH_MISMATCH",
            ...(declarationMatches ? [declared.provenance.source] : [])
          ],
          attributionRequired: declarationMatches ? declared.attributionRequired : false,
          distributed: true
        });
      }
    }
  }
  await walk(publicDir);
  const actualPaths = new Set(subjects.filter((subject) => subject.id.startsWith("asset:apps/site/public/")).map((subject) => subject.id.slice("asset:".length)));
  for (const entry of evidenceIndex.values()) {
    if (!actualPaths.has(entry.path)) {
      subjects.push({ id: `asset:${entry.path}`, kind: "asset", name: relative(publicDir, resolve(root, entry.path)), versionOrIdentity: "DECLARED_ASSET_ABSENT", licenseExpression: entry.licenseExpression, state: "UNKNOWN", evidence: ["rights-asset-provenance.json", "diagnostic:asset-provenance:DECLARED_ASSET_ABSENT"], attributionRequired: entry.attributionRequired, distributed: true });
    }
  }
  return subjects;
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
    if (subject.state === "REVIEW_REQUIRED") return {
      ...subject,
      state: "ALLOW" as const,
      attributionRequired: true,
      evidence: [...subject.evidence, `waiver:${waiver.owner}:${waiver.scope}:${waiver.expiresAt}`]
    };
    return subject;
  }), expiredWaivers, diagnostics };
}

export async function scanRepositoryRights(root = process.cwd(), waivers: Waiver[] = [], now = new Date()): Promise<RepositoryClearanceReceipt> {
  const { stdout } = await execFileAsync("pnpm", ["-r", "list", "--prod", "--json", "--depth", "Infinity"], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const dependencies = flattenTree(JSON.parse(stdout) as PnpmProject[]);
  const metadata = await packageMetadataIndex(root);
  const loadedOverrides = await loadOverrides(root);
  const overrides = loadedOverrides.entries;
  const packageDiagnostics = new Set<string>(loadedOverrides.diagnostic ? [loadedOverrides.diagnostic] : []);
  const packageSubjects: RightsSubject[] = await Promise.all([...dependencies.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)).map(async ({ name, version, installPath }) => {
    const id = `${name}@${version}`;
    const installed = metadata.index.get(id);
    const override = overrides[id];
    const metadataFailures = metadata.failuresByName.get(name) ?? metadata.globalFailures;
    const installPathTraversal = installPath ? relative(root, installPath) : null;
    const installPathIsInsideRoot = installPathTraversal !== null && installPathTraversal.split(/[\\/]/)[0] !== ".." && !isAbsolute(installPathTraversal);
    if (installPath && installPathIsInsideRoot && !existsSync(installPath)) {
      return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: override?.license ?? null, state: "NOT_DISTRIBUTED" as const, evidence: [`pnpm production graph:${id}`, "release target package path is absent"], attributionRequired: false, distributed: false };
    }
    if (!installed && installPath && !installPathIsInsideRoot) {
      const diagnostic = `diagnostic:package-path:OUTSIDE_ROOT:${id}`;
      packageDiagnostics.add(diagnostic);
      return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: null, state: "UNKNOWN" as const, evidence: [`pnpm production graph:${id}`, diagnostic], attributionRequired: false, distributed: true };
    }
    if (installPath && installPathIsInsideRoot) {
      const exact = await packageMetadataAtInstallPath(root, installPath, name, version);
      if ("diagnostic" in exact) {
        packageDiagnostics.add(exact.diagnostic);
        return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: null, state: "UNKNOWN" as const, evidence: [`pnpm production graph:${id}`, exact.diagnostic], attributionRequired: false, distributed: true };
      }
      const license = exact.license ?? override?.license ?? null;
      const state = classifyLicense(license);
      return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: license, state, evidence: [exact.path, ...(override ? [override.source] : []), `pnpm production graph:${id}`], attributionRequired: state === "ALLOW", distributed: true };
    }
    if (!installed && metadataFailures.length > 0) {
      for (const diagnostic of metadataFailures) packageDiagnostics.add(diagnostic);
      return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: null, state: "UNKNOWN" as const, evidence: [`pnpm production graph:${id}`, ...metadataFailures], attributionRequired: false, distributed: true };
    }
    if (!installed) return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: override?.license ?? null, state: "NOT_DISTRIBUTED" as const, evidence: [`pnpm production graph:${id}`, "not installed in current release target node_modules"], attributionRequired: false, distributed: false };
    const license = installed.license ?? override?.license ?? null;
    const state = classifyLicense(license);
    return { id: `package:${id}`, kind: "package" as const, name, versionOrIdentity: version, licenseExpression: license, state, evidence: [installed.path, ...(override ? [override.source] : []), `pnpm production graph:${id}`], attributionRequired: state === "ALLOW", distributed: true };
  }));
  const fixedSubjects: RightsSubject[] = [
    { id: "font:system-stack", kind: "font", name: "system font stack", versionOrIdentity: "runtime-system", licenseExpression: null, state: "NOT_DISTRIBUTED", evidence: ["system/fallback font names only; no font binary shipped"], attributionRequired: false, distributed: false },
    { id: "model:internal-deterministic-mock", kind: "model", name: "internal deterministic mock", versionOrIdentity: "internal/v1", licenseExpression: "REPO_ORIGINAL", state: "ALLOW", evidence: ["src/media-router.ts", "deterministic worker fixture"], attributionRequired: false, distributed: true },
    { id: "service:none-required", kind: "service", name: "no mandatory third-party hosted service", versionOrIdentity: "v1-core", licenseExpression: "REPO_POLICY", state: "ALLOW", evidence: ["core runtime operates without third-party hosted service credentials"], attributionRequired: false, distributed: false }
  ];
  const productionRights = await loadProductionRightsEvidence(root);
  if (productionRights.diagnostic) packageDiagnostics.add(productionRights.diagnostic);
  const initialSubjects = [...packageSubjects, ...await scanShippedAssets(root), ...fixedSubjects, ...productionRights.subjects];
  const seenSubjectIds = new Set<string>();
  for (const subject of initialSubjects) {
    if (seenSubjectIds.has(subject.id)) packageDiagnostics.add(`diagnostic:production-rights:DUPLICATE_SUBJECT:${subject.id}`);
    seenSubjectIds.add(subject.id);
  }
  const applied = applyWaivers(initialSubjects, waivers, now);
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
