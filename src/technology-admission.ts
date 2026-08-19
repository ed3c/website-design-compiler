import { createHash } from "node:crypto";

export type TechnologySubjectKind =
  | "SOFTWARE_PACKAGE"
  | "GIT_REPOSITORY"
  | "MODEL_WEIGHT"
  | "GENERATED_OUTPUT_TERMS"
  | "HOSTED_SERVICE"
  | "DATA_USE_TERMS"
  | "ASSET"
  | "FONT"
  | "CODEC";

export type TechnologyLifecycle = "CANDIDATE" | "ADOPTED" | "REJECTED" | "OPTIONAL" | "OUT_OF_SCOPE";
export type Optionality = "CORE" | "OPTIONAL" | "SEPARATE_PRODUCT";
export type EngineeringDecision = "ALLOW" | "REVIEW_REQUIRED" | "DENY" | "UNKNOWN";
export type RightsState = EngineeringDecision | "NOT_APPLICABLE";
export type RightsSubjectKind =
  | "SOFTWARE_LICENSE"
  | "MODEL_WEIGHT_LICENSE"
  | "GENERATED_OUTPUT_TERMS"
  | "HOSTED_SERVICE_TERMS"
  | "DATA_USE_TERMS"
  | "ASSET_RIGHTS"
  | "FONT_RIGHTS"
  | "CODEC_RIGHTS";

export interface PackageIdentity {
  kind: "PACKAGE";
  packageName: string;
  version: string;
  registryUrl: string;
  distributionSha256: string;
}

export interface GitIdentity {
  kind: "GIT";
  repositoryUrl: string;
  commit: string;
  tree: string;
}

export interface ArtifactIdentity {
  kind: "ARTIFACT";
  versionOrRevision: string;
  sourceUrl: string;
  sourceSha256: string;
}

export type ExactTechnologyIdentity = PackageIdentity | GitIdentity | ArtifactIdentity;

export interface EvidenceAnchor {
  sourceIdentitySha256: string;
  observationIdentitySha256: string;
}

export interface TechnologyCandidate {
  schema: "website-design-compiler/technology-candidate/v1";
  candidateId: string;
  subjectKind: TechnologySubjectKind;
  lifecycle: TechnologyLifecycle;
  name: string;
  runtimeRole: string;
  optionality: Optionality;
  replacementTarget: string | null;
  capabilityJustification: string;
  acceptanceCriteria: string[];
  identity: ExactTechnologyIdentity;
  licenseExpression: string | null;
  licenseTextSha256: string | null;
  noticeRequired: boolean;
  attributionRequired: boolean;
  transitiveDependencyCount: number;
  transitiveGraphSha256: string;
  evidenceAnchors: EvidenceAnchor[];
  candidateIdentitySha256: string;
}

export interface RightsSubjectDecision {
  subjectId: string;
  kind: RightsSubjectKind;
  state: RightsState;
  evidenceSha256: string;
}

export interface TechnologyAdmission {
  schema: "website-design-compiler/technology-admission/v1";
  candidateIdentitySha256: string;
  buildSubjectSha256: string;
  decision: EngineeringDecision;
  rightsSubjects: RightsSubjectDecision[];
  evaluatedAt: string;
  authority: "ENGINEERING_POLICY";
  legalDisclaimer: "ENGINEERING_ADMISSION_NOT_LEGAL_ADVICE";
  admissionIdentitySha256: string;
}

export interface TechnologyRevocation {
  schema: "website-design-compiler/technology-revocation/v1";
  candidateIdentitySha256: string;
  admissionIdentitySha256: string;
  observedChangeSha256: string;
  reason: string;
  revokedAt: string;
  revocationIdentitySha256: string;
}

export interface TechnologyCandidateInput extends Omit<TechnologyCandidate, "schema" | "candidateId" | "candidateIdentitySha256"> {}
export interface TechnologyAdmissionInput extends Omit<TechnologyAdmission, "schema" | "decision" | "authority" | "legalDisclaimer" | "admissionIdentitySha256"> {}
export interface TechnologyRevocationInput extends Omit<TechnologyRevocation, "schema" | "revocationIdentitySha256"> {}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const PACKAGE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const SUBJECT_KINDS = new Set<TechnologySubjectKind>([
  "SOFTWARE_PACKAGE", "GIT_REPOSITORY", "MODEL_WEIGHT", "GENERATED_OUTPUT_TERMS", "HOSTED_SERVICE",
  "DATA_USE_TERMS", "ASSET", "FONT", "CODEC"
]);
const LIFECYCLES = new Set<TechnologyLifecycle>(["CANDIDATE", "ADOPTED", "REJECTED", "OPTIONAL", "OUT_OF_SCOPE"]);
const OPTIONALITIES = new Set<Optionality>(["CORE", "OPTIONAL", "SEPARATE_PRODUCT"]);
const RIGHTS_KINDS = new Set<RightsSubjectKind>([
  "SOFTWARE_LICENSE", "MODEL_WEIGHT_LICENSE", "GENERATED_OUTPUT_TERMS", "HOSTED_SERVICE_TERMS", "DATA_USE_TERMS",
  "ASSET_RIGHTS", "FONT_RIGHTS", "CODEC_RIGHTS"
]);
const RIGHTS_STATES = new Set<RightsState>(["ALLOW", "REVIEW_REQUIRED", "DENY", "UNKNOWN", "NOT_APPLICABLE"]);

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must be non-empty`);
  return normalized;
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function gitSha(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GIT_SHA.test(normalized)) throw new Error(`${field} must be an exact 40-character Git SHA`);
  return normalized;
}

function exactIso(value: string, field: string): string {
  const normalized = nonEmpty(value, field);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) {
    throw new Error(`${field} must be an exact ISO-8601 UTC timestamp`);
  }
  return normalized;
}

function publicHttpsUrl(value: string, field: string): string {
  let url: URL;
  try { url = new URL(nonEmpty(value, field)); }
  catch { throw new Error(`${field} must be a valid HTTPS URL`); }
  if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${field} must not contain credentials`);
  if (url.search || url.hash) throw new Error(`${field} must not contain query or fragment data`);
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error(`${field} must not identify a local host`);
  }
  return url.toString();
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`canonical JSON does not support ${typeof value}`);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function normalizeIdentity(identity: ExactTechnologyIdentity): ExactTechnologyIdentity {
  if (identity.kind === "PACKAGE") {
    const packageName = nonEmpty(identity.packageName, "identity.packageName");
    if (!PACKAGE_NAME.test(packageName)) throw new Error("identity.packageName is malformed");
    const version = nonEmpty(identity.version, "identity.version");
    if (!PACKAGE_VERSION.test(version) || version.toLowerCase() === "latest") {
      throw new Error("identity.version must be exact and must not be a range or floating tag");
    }
    return {
      kind: "PACKAGE",
      packageName,
      version,
      registryUrl: publicHttpsUrl(identity.registryUrl, "identity.registryUrl"),
      distributionSha256: sha256(identity.distributionSha256, "identity.distributionSha256")
    };
  }
  if (identity.kind === "GIT") {
    const repositoryUrl = publicHttpsUrl(identity.repositoryUrl, "identity.repositoryUrl");
    const url = new URL(repositoryUrl);
    if (url.hostname.toLowerCase() !== "github.com") throw new Error("identity.repositoryUrl must identify public GitHub");
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) throw new Error("identity.repositoryUrl must identify exactly owner/repository");
    return { kind: "GIT", repositoryUrl, commit: gitSha(identity.commit, "identity.commit"), tree: gitSha(identity.tree, "identity.tree") };
  }
  return {
    kind: "ARTIFACT",
    versionOrRevision: nonEmpty(identity.versionOrRevision, "identity.versionOrRevision"),
    sourceUrl: publicHttpsUrl(identity.sourceUrl, "identity.sourceUrl"),
    sourceSha256: sha256(identity.sourceSha256, "identity.sourceSha256")
  };
}

function normalizeAnchors(anchors: readonly EvidenceAnchor[]): EvidenceAnchor[] {
  if (anchors.length === 0) throw new Error("technology candidate requires at least one evidence anchor");
  const normalized = anchors.map((anchor) => ({
    sourceIdentitySha256: sha256(anchor.sourceIdentitySha256, "evidenceAnchors.sourceIdentitySha256"),
    observationIdentitySha256: sha256(anchor.observationIdentitySha256, "evidenceAnchors.observationIdentitySha256")
  }));
  normalized.sort((a, b) => a.sourceIdentitySha256.localeCompare(b.sourceIdentitySha256) || a.observationIdentitySha256.localeCompare(b.observationIdentitySha256));
  const seen = new Set<string>();
  for (const anchor of normalized) {
    const key = `${anchor.sourceIdentitySha256}:${anchor.observationIdentitySha256}`;
    if (seen.has(key)) throw new Error("technology candidate contains duplicate evidence anchors");
    seen.add(key);
  }
  return normalized;
}

export function createTechnologyCandidate(input: TechnologyCandidateInput): TechnologyCandidate {
  if (!SUBJECT_KINDS.has(input.subjectKind)) throw new Error("subjectKind is invalid");
  if (!LIFECYCLES.has(input.lifecycle)) throw new Error("lifecycle is invalid");
  if (!OPTIONALITIES.has(input.optionality)) throw new Error("optionality is invalid");
  if (!Number.isInteger(input.transitiveDependencyCount) || input.transitiveDependencyCount < 0) {
    throw new Error("transitiveDependencyCount must be a non-negative integer");
  }
  const acceptanceCriteria = [...new Set(input.acceptanceCriteria.map((entry) => nonEmpty(entry, "acceptanceCriteria")))].sort();
  if (acceptanceCriteria.length === 0) throw new Error("technology candidate requires measurable acceptance criteria");
  const normalized = {
    subjectKind: input.subjectKind,
    lifecycle: input.lifecycle,
    name: nonEmpty(input.name, "name"),
    runtimeRole: nonEmpty(input.runtimeRole, "runtimeRole"),
    optionality: input.optionality,
    replacementTarget: input.replacementTarget === null ? null : nonEmpty(input.replacementTarget, "replacementTarget"),
    capabilityJustification: nonEmpty(input.capabilityJustification, "capabilityJustification"),
    acceptanceCriteria,
    identity: normalizeIdentity(input.identity),
    licenseExpression: input.licenseExpression === null ? null : nonEmpty(input.licenseExpression, "licenseExpression"),
    licenseTextSha256: input.licenseTextSha256 === null ? null : sha256(input.licenseTextSha256, "licenseTextSha256"),
    noticeRequired: input.noticeRequired,
    attributionRequired: input.attributionRequired,
    transitiveDependencyCount: input.transitiveDependencyCount,
    transitiveGraphSha256: sha256(input.transitiveGraphSha256, "transitiveGraphSha256"),
    evidenceAnchors: normalizeAnchors(input.evidenceAnchors)
  };
  const candidateIdentitySha256 = digest({ schema: "website-design-compiler/technology-candidate/v1", ...normalized });
  return {
    schema: "website-design-compiler/technology-candidate/v1",
    candidateId: `tech-${candidateIdentitySha256.slice(0, 20)}`,
    ...normalized,
    candidateIdentitySha256
  };
}

function normalizeRightsSubjects(subjects: readonly RightsSubjectDecision[]): RightsSubjectDecision[] {
  if (subjects.length === 0) throw new Error("technology admission requires at least one rights subject");
  const normalized = subjects.map((subject) => {
    if (!RIGHTS_KINDS.has(subject.kind)) throw new Error("rights subject kind is invalid");
    if (!RIGHTS_STATES.has(subject.state)) throw new Error("rights subject state is invalid");
    return {
      subjectId: nonEmpty(subject.subjectId, "rightsSubjects.subjectId"),
      kind: subject.kind,
      state: subject.state,
      evidenceSha256: sha256(subject.evidenceSha256, "rightsSubjects.evidenceSha256")
    };
  }).sort((a, b) => a.subjectId.localeCompare(b.subjectId));
  const ids = new Set<string>();
  for (const subject of normalized) {
    if (ids.has(subject.subjectId)) throw new Error(`duplicate rights subject: ${subject.subjectId}`);
    ids.add(subject.subjectId);
  }
  return normalized;
}

export function deriveEngineeringDecision(subjects: readonly RightsSubjectDecision[]): EngineeringDecision {
  const applicable = subjects.filter((subject) => subject.state !== "NOT_APPLICABLE");
  if (applicable.length === 0) return "UNKNOWN";
  if (applicable.some((subject) => subject.state === "DENY")) return "DENY";
  if (applicable.some((subject) => subject.state === "UNKNOWN")) return "UNKNOWN";
  if (applicable.some((subject) => subject.state === "REVIEW_REQUIRED")) return "REVIEW_REQUIRED";
  return "ALLOW";
}

export function createTechnologyAdmission(input: TechnologyAdmissionInput): TechnologyAdmission {
  const rightsSubjects = normalizeRightsSubjects(input.rightsSubjects);
  const candidateIdentitySha256 = sha256(input.candidateIdentitySha256, "candidateIdentitySha256");
  const buildSubjectSha256 = sha256(input.buildSubjectSha256, "buildSubjectSha256");
  const evaluatedAt = exactIso(input.evaluatedAt, "evaluatedAt");
  const decision = deriveEngineeringDecision(rightsSubjects);
  const stable = {
    schema: "website-design-compiler/technology-admission/v1" as const,
    candidateIdentitySha256,
    buildSubjectSha256,
    decision,
    rightsSubjects,
    authority: "ENGINEERING_POLICY" as const,
    legalDisclaimer: "ENGINEERING_ADMISSION_NOT_LEGAL_ADVICE" as const
  };
  return { ...stable, evaluatedAt, admissionIdentitySha256: digest(stable) };
}

export function createTechnologyRevocation(input: TechnologyRevocationInput): TechnologyRevocation {
  const stable = {
    schema: "website-design-compiler/technology-revocation/v1" as const,
    candidateIdentitySha256: sha256(input.candidateIdentitySha256, "candidateIdentitySha256"),
    admissionIdentitySha256: sha256(input.admissionIdentitySha256, "admissionIdentitySha256"),
    observedChangeSha256: sha256(input.observedChangeSha256, "observedChangeSha256"),
    reason: nonEmpty(input.reason, "reason")
  };
  return { ...stable, revokedAt: exactIso(input.revokedAt, "revokedAt"), revocationIdentitySha256: digest(stable) };
}
