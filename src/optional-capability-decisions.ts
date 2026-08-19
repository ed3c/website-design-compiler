import { createHash } from "node:crypto";

export type OptionalCapabilityTrack = "THREE_D_PRODUCT_PHOTOSHOOT" | "MOTION_VIDEO_EXPORT" | "DJ_AUDIO_ENGINE";
export type OptionalCapabilityDecision = "ADOPT" | "DEFER" | "REJECT" | "SEPARATE_PRODUCT";

export interface DecisionEvidenceAnchor {
  sourceIdentitySha256: string;
  observationIdentitySha256: string;
}

export interface OptionalCapabilityDecisionInput {
  track: OptionalCapabilityTrack;
  decision: OptionalCapabilityDecision;
  rationale: string;
  evidenceAnchors: readonly DecisionEvidenceAnchor[];
  requiredPrerequisites: readonly string[];
  blockedByIssues: readonly number[];
  requiredFallbacks: readonly string[];
  dependencyAdmissionRequired: boolean;
  providerAdmissionRequired: boolean;
  humanAdmissionRequired: boolean;
  implementationStartCondition: string;
  targetProduct: string | null;
  decidedAt: string;
}

export interface OptionalCapabilityDecisionPacket {
  schema: "website-design-compiler/optional-capability-decision/v1";
  decisionId: string;
  track: OptionalCapabilityTrack;
  decision: OptionalCapabilityDecision;
  rationale: string;
  evidenceAnchors: DecisionEvidenceAnchor[];
  requiredPrerequisites: string[];
  blockedByIssues: number[];
  requiredFallbacks: string[];
  dependencyAdmissionRequired: boolean;
  providerAdmissionRequired: boolean;
  humanAdmissionRequired: boolean;
  implementationStartCondition: string;
  targetProduct: string | null;
  implementationEligible: false;
  decisionIdentitySha256: string;
  decidedAt: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const TRACKS = new Set<OptionalCapabilityTrack>(["THREE_D_PRODUCT_PHOTOSHOOT", "MOTION_VIDEO_EXPORT", "DJ_AUDIO_ENGINE"]);
const DECISIONS = new Set<OptionalCapabilityDecision>(["ADOPT", "DEFER", "REJECT", "SEPARATE_PRODUCT"]);
const PRODUCT = /^[a-z0-9][a-z0-9._-]{2,127}$/;

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("decision packet cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`canonical JSON does not support ${typeof value}`);
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function exactSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be non-empty`);
  return normalized;
}

function exactTimestamp(value: string): string {
  const normalized = nonEmpty(value, "decidedAt");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) throw new Error("decidedAt must be an exact ISO-8601 UTC timestamp");
  return normalized;
}

function normalizedStrings(values: readonly string[], field: string, requireOne = false): string[] {
  const result = [...new Set(values.map((value) => nonEmpty(value, field)))].sort();
  if (requireOne && result.length === 0) throw new Error(`${field} requires at least one entry`);
  return result;
}

function normalizedIssues(values: readonly number[]): number[] {
  const result = [...new Set(values)].sort((a, b) => a - b);
  if (result.some((value) => !Number.isInteger(value) || value < 1)) throw new Error("blockedByIssues must contain positive GitHub issue numbers");
  return result;
}

function normalizedEvidence(values: readonly DecisionEvidenceAnchor[]): DecisionEvidenceAnchor[] {
  if (values.length === 0) throw new Error("optional capability decision requires at least one evidence anchor");
  const result = values.map((anchor) => ({
    sourceIdentitySha256: exactSha256(anchor.sourceIdentitySha256, "evidence.sourceIdentitySha256"),
    observationIdentitySha256: exactSha256(anchor.observationIdentitySha256, "evidence.observationIdentitySha256")
  })).sort((a, b) => a.sourceIdentitySha256.localeCompare(b.sourceIdentitySha256) || a.observationIdentitySha256.localeCompare(b.observationIdentitySha256));
  const keys = new Set<string>();
  for (const anchor of result) {
    const key = `${anchor.sourceIdentitySha256}:${anchor.observationIdentitySha256}`;
    if (keys.has(key)) throw new Error("optional capability decision contains duplicate evidence anchors");
    keys.add(key);
  }
  return result;
}

function normalizedTargetProduct(decision: OptionalCapabilityDecision, value: string | null): string | null {
  if (decision === "SEPARATE_PRODUCT") {
    if (value === null) throw new Error("SEPARATE_PRODUCT requires a targetProduct");
    const normalized = nonEmpty(value, "targetProduct").toLowerCase();
    if (!PRODUCT.test(normalized)) throw new Error("targetProduct must be a stable product identifier");
    if (normalized === "website-design-compiler") throw new Error("SEPARATE_PRODUCT targetProduct must differ from website-design-compiler");
    return normalized;
  }
  if (value !== null) throw new Error(`${decision} decision must not assign targetProduct`);
  return null;
}

export function createOptionalCapabilityDecisionPacket(input: OptionalCapabilityDecisionInput): OptionalCapabilityDecisionPacket {
  if (!TRACKS.has(input.track)) throw new Error("optional capability track is invalid");
  if (!DECISIONS.has(input.decision)) throw new Error("optional capability decision is invalid");
  const requiredPrerequisites = normalizedStrings(input.requiredPrerequisites, "requiredPrerequisites", input.decision === "ADOPT");
  const requiredFallbacks = normalizedStrings(input.requiredFallbacks, "requiredFallbacks", input.decision === "ADOPT");
  const blockedByIssues = normalizedIssues(input.blockedByIssues);
  const implementationStartCondition = nonEmpty(input.implementationStartCondition, "implementationStartCondition");
  if (input.decision === "ADOPT" && blockedByIssues.length === 0) {
    throw new Error("ADOPT must explicitly record at least one prerequisite issue gate before implementation");
  }
  const stable = {
    schema: "website-design-compiler/optional-capability-decision/v1" as const,
    track: input.track,
    decision: input.decision,
    rationale: nonEmpty(input.rationale, "rationale"),
    evidenceAnchors: normalizedEvidence(input.evidenceAnchors),
    requiredPrerequisites,
    blockedByIssues,
    requiredFallbacks,
    dependencyAdmissionRequired: input.dependencyAdmissionRequired,
    providerAdmissionRequired: input.providerAdmissionRequired,
    humanAdmissionRequired: input.humanAdmissionRequired,
    implementationStartCondition,
    targetProduct: normalizedTargetProduct(input.decision, input.targetProduct),
    implementationEligible: false as const
  };
  const decisionIdentitySha256 = hash(stable);
  return {
    ...stable,
    decisionId: `decision-${decisionIdentitySha256.slice(0, 20)}`,
    decisionIdentitySha256,
    decidedAt: exactTimestamp(input.decidedAt)
  };
}

export function decisionMayOpenImplementationDag(packet: OptionalCapabilityDecisionPacket, satisfiedIssueNumbers: readonly number[]): boolean {
  if (packet.decision !== "ADOPT") return false;
  const satisfied = new Set(satisfiedIssueNumbers);
  return packet.blockedByIssues.length > 0 && packet.blockedByIssues.every((issue) => satisfied.has(issue));
}
