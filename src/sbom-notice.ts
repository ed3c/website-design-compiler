import { createHash } from "node:crypto";

export type PackageMetadataState = "COMPLETE" | "MISSING" | "READ_ERROR" | "PARSE_ERROR";
export type ComponentEvidenceState = "COMPLETE" | "INCOMPLETE" | "NOT_DISTRIBUTED";

export interface BuildPackageSubject {
  name: string;
  version: string;
  artifactSha256: string;
  distributed: boolean;
  metadataState: PackageMetadataState;
  metadataDiagnostic: string | null;
  licenseExpression: string | null;
  licenseTextSha256: string | null;
  attributionRequired: boolean;
  noticeTextSha256: string | null;
  admissionIdentitySha256: string | null;
}

export interface SbomNoticeInput {
  repositoryTree: string;
  lockfileSha256: string;
  productionGraphSha256: string;
  packages: readonly BuildPackageSubject[];
  generatedAt: string;
}

export interface SbomComponentEvidence extends BuildPackageSubject {
  bomRef: string;
  evidenceState: ComponentEvidenceState;
}

export interface NoticeSubject {
  bomRef: string;
  name: string;
  version: string;
  artifactSha256: string;
  noticeTextSha256: string;
  admissionIdentitySha256: string;
}

export interface SbomNoticeEvidence {
  schema: "website-design-compiler/sbom-notice-evidence/v1";
  format: "website-design-compiler/sbom-lite/v1";
  buildSubjectSha256: string;
  repositoryTree: string;
  lockfileSha256: string;
  productionGraphSha256: string;
  components: SbomComponentEvidence[];
  noticeSubjects: NoticeSubject[];
  blockingDiagnostics: string[];
  overall: "PASS" | "FAIL";
  generatedAt: string;
  evidenceIdentitySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const EXACT_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const METADATA_STATES = new Set<PackageMetadataState>(["COMPLETE", "MISSING", "READ_ERROR", "PARSE_ERROR"]);

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`unsupported canonical JSON value: ${typeof value}`);
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be non-empty`);
  return normalized;
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function optionalSha256(value: string | null, field: string): string | null {
  return value === null ? null : sha256(value, field);
}

function exactVersion(value: string): string {
  const normalized = nonEmpty(value, "version");
  if (!EXACT_VERSION.test(normalized) || normalized.toLowerCase() === "latest") {
    throw new Error("version must be an exact non-floating package version");
  }
  return normalized;
}

function exactTimestamp(value: string): string {
  const normalized = nonEmpty(value, "generatedAt");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) throw new Error("generatedAt must be an exact ISO-8601 UTC timestamp");
  return normalized;
}

function normalizePackage(subject: BuildPackageSubject): BuildPackageSubject {
  const name = nonEmpty(subject.name, "name");
  if (!PACKAGE_NAME.test(name)) throw new Error(`package name is malformed: ${name}`);
  if (!METADATA_STATES.has(subject.metadataState)) throw new Error(`metadataState is invalid for ${name}`);
  const metadataDiagnostic = subject.metadataDiagnostic === null ? null : nonEmpty(subject.metadataDiagnostic, "metadataDiagnostic");
  if (subject.metadataState === "COMPLETE" && metadataDiagnostic !== null) throw new Error(`COMPLETE metadata cannot carry a diagnostic for ${name}`);
  if (subject.metadataState !== "COMPLETE" && metadataDiagnostic === null) throw new Error(`incomplete metadata requires a diagnostic for ${name}`);
  return {
    name,
    version: exactVersion(subject.version),
    artifactSha256: sha256(subject.artifactSha256, "artifactSha256"),
    distributed: subject.distributed,
    metadataState: subject.metadataState,
    metadataDiagnostic,
    licenseExpression: subject.licenseExpression === null ? null : nonEmpty(subject.licenseExpression, "licenseExpression"),
    licenseTextSha256: optionalSha256(subject.licenseTextSha256, "licenseTextSha256"),
    attributionRequired: subject.attributionRequired,
    noticeTextSha256: optionalSha256(subject.noticeTextSha256, "noticeTextSha256"),
    admissionIdentitySha256: optionalSha256(subject.admissionIdentitySha256, "admissionIdentitySha256")
  };
}

function componentState(subject: BuildPackageSubject, diagnostics: string[]): ComponentEvidenceState {
  if (!subject.distributed) return "NOT_DISTRIBUTED";
  const prefix = `${subject.name}@${subject.version}`;
  let incomplete = false;
  if (subject.metadataState !== "COMPLETE") {
    diagnostics.push(`${prefix}: package metadata ${subject.metadataState}: ${subject.metadataDiagnostic ?? "UNKNOWN"}`);
    incomplete = true;
  }
  if (subject.licenseExpression === null || subject.licenseExpression === "NOASSERTION") {
    diagnostics.push(`${prefix}: exact license expression evidence is absent`);
    incomplete = true;
  }
  if (subject.licenseTextSha256 === null) {
    diagnostics.push(`${prefix}: exact license text digest is absent`);
    incomplete = true;
  }
  if (subject.admissionIdentitySha256 === null) {
    diagnostics.push(`${prefix}: exact technology admission identity is absent`);
    incomplete = true;
  }
  if (subject.attributionRequired && subject.noticeTextSha256 === null) {
    diagnostics.push(`${prefix}: attribution is required but notice text digest is absent`);
    incomplete = true;
  }
  return incomplete ? "INCOMPLETE" : "COMPLETE";
}

export function createSbomNoticeEvidence(input: SbomNoticeInput): SbomNoticeEvidence {
  const repositoryTree = input.repositoryTree.trim().toLowerCase();
  if (!GIT_SHA.test(repositoryTree)) throw new Error("repositoryTree must be an exact 40-character Git tree SHA");
  const lockfileSha256 = sha256(input.lockfileSha256, "lockfileSha256");
  const productionGraphSha256 = sha256(input.productionGraphSha256, "productionGraphSha256");
  const generatedAt = exactTimestamp(input.generatedAt);
  if (input.packages.length === 0) throw new Error("SBOM evidence requires at least one package subject");

  const packages = input.packages.map(normalizePackage).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.artifactSha256.localeCompare(b.artifactSha256));
  const blockingDiagnostics: string[] = [];
  const seen = new Set<string>();
  const components = packages.map((subject) => {
    const identity = `${subject.name}@${subject.version}:${subject.artifactSha256}`;
    if (seen.has(identity)) throw new Error(`duplicate exact package subject: ${identity}`);
    seen.add(identity);
    const bomRef = `pkg:${subject.name}@${subject.version}#sha256:${subject.artifactSha256}`;
    return { ...subject, bomRef, evidenceState: componentState(subject, blockingDiagnostics) };
  });

  const noticeSubjects: NoticeSubject[] = components
    .filter((component) => component.distributed && component.attributionRequired && component.noticeTextSha256 !== null && component.admissionIdentitySha256 !== null)
    .map((component) => ({
      bomRef: component.bomRef,
      name: component.name,
      version: component.version,
      artifactSha256: component.artifactSha256,
      noticeTextSha256: component.noticeTextSha256!,
      admissionIdentitySha256: component.admissionIdentitySha256!
    }));

  const buildSubjectSha256 = hash({ repositoryTree, lockfileSha256, productionGraphSha256, components: components.map(({ evidenceState: _state, ...component }) => component) });
  const stable = {
    schema: "website-design-compiler/sbom-notice-evidence/v1" as const,
    format: "website-design-compiler/sbom-lite/v1" as const,
    buildSubjectSha256,
    repositoryTree,
    lockfileSha256,
    productionGraphSha256,
    components,
    noticeSubjects,
    blockingDiagnostics: [...new Set(blockingDiagnostics)].sort(),
    overall: blockingDiagnostics.length === 0 ? "PASS" as const : "FAIL" as const
  };
  return { ...stable, generatedAt, evidenceIdentitySha256: hash(stable) };
}
