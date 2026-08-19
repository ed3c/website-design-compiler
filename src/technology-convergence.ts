import { createHash } from "node:crypto";
import { evaluateSpdxExpression, type SpdxEvaluation } from "./spdx-policy.js";
import type { SbomComponentEvidence, SbomNoticeEvidence } from "./sbom-notice.js";
import {
  createTechnologyAdmission,
  createTechnologyRevocation,
  type TechnologyAdmission,
  type TechnologyCandidate,
  type TechnologyRevocation
} from "./technology-admission.js";

export interface TechnologyConvergenceReceipt {
  schema: "website-design-compiler/technology-convergence-receipt/v1";
  candidateIdentitySha256: string;
  buildSubjectSha256: string;
  sbomEvidenceIdentitySha256: string;
  componentBomRef: string;
  spdxEvaluationIdentitySha256: string;
  policyState: SpdxEvaluation["state"];
  engineeringDecision: TechnologyAdmission["decision"];
  humanLegalState: "NOT_EVALUATED";
  admissionIdentitySha256: string;
  rightsEvidenceSha256: string;
  evaluatedAt: string;
  receiptIdentitySha256: string;
}

export interface ConvergedTechnologyAdmission {
  admission: TechnologyAdmission;
  spdx: SpdxEvaluation;
  receipt: TechnologyConvergenceReceipt;
}

const SHA256 = /^[a-f0-9]{64}$/;

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

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function exactSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function exactTimestamp(value: string): string {
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) {
    throw new Error("evaluatedAt must be an exact ISO-8601 UTC timestamp");
  }
  return normalized;
}

function exactPackageComponent(candidate: TechnologyCandidate, sbom: SbomNoticeEvidence): SbomComponentEvidence {
  if (candidate.subjectKind !== "SOFTWARE_PACKAGE" || candidate.identity.kind !== "PACKAGE") {
    throw new Error("technology convergence currently requires an exact SOFTWARE_PACKAGE candidate");
  }
  if (sbom.overall !== "PASS") throw new Error("SBOM/notice evidence must PASS before technology convergence");
  const component = sbom.components.find((entry) =>
    entry.name === candidate.identity.packageName &&
    entry.version === candidate.identity.version &&
    entry.artifactSha256 === candidate.identity.distributionSha256
  );
  if (!component) throw new Error("SBOM does not contain the candidate exact package/version/artifact subject");
  if (!component.distributed || component.evidenceState !== "COMPLETE") {
    throw new Error("candidate exact package must be a COMPLETE distributed SBOM component");
  }
  return component;
}

function assertCandidateEvidenceAlignment(candidate: TechnologyCandidate, component: SbomComponentEvidence): void {
  if (candidate.licenseExpression === null || component.licenseExpression === null) {
    throw new Error("exact software license expression is required for convergence");
  }
  if (candidate.licenseExpression !== component.licenseExpression) throw new Error("candidate and SBOM license expressions drifted");
  if (candidate.licenseTextSha256 === null || candidate.licenseTextSha256 !== component.licenseTextSha256) {
    throw new Error("candidate and SBOM license text digest drifted");
  }
  if (candidate.attributionRequired !== component.attributionRequired) throw new Error("candidate and SBOM attribution requirement drifted");
  if (candidate.noticeRequired && component.noticeTextSha256 === null) throw new Error("candidate requires notice evidence but SBOM notice digest is absent");
}

export function createConvergedTechnologyAdmission(
  candidate: TechnologyCandidate,
  sbom: SbomNoticeEvidence,
  evaluatedAtValue: string
): ConvergedTechnologyAdmission {
  const component = exactPackageComponent(candidate, sbom);
  assertCandidateEvidenceAlignment(candidate, component);
  const spdx = evaluateSpdxExpression(component.licenseExpression!);
  const rightsEvidenceSha256 = digest({
    schema: "website-design-compiler/software-rights-evidence/v1",
    candidateIdentitySha256: exactSha256(candidate.candidateIdentitySha256, "candidateIdentitySha256"),
    buildSubjectSha256: exactSha256(sbom.buildSubjectSha256, "buildSubjectSha256"),
    sbomEvidenceIdentitySha256: exactSha256(sbom.evidenceIdentitySha256, "sbomEvidenceIdentitySha256"),
    componentBomRef: component.bomRef,
    artifactSha256: component.artifactSha256,
    licenseTextSha256: component.licenseTextSha256,
    noticeTextSha256: component.noticeTextSha256,
    spdxEvaluationIdentitySha256: spdx.evaluationIdentitySha256
  });
  const evaluatedAt = exactTimestamp(evaluatedAtValue);
  const admission = createTechnologyAdmission({
    candidateIdentitySha256: candidate.candidateIdentitySha256,
    buildSubjectSha256: sbom.buildSubjectSha256,
    rightsSubjects: [{
      subjectId: `${component.bomRef}:software-license`,
      kind: "SOFTWARE_LICENSE",
      state: spdx.state,
      evidenceSha256: rightsEvidenceSha256
    }],
    evaluatedAt
  });
  const stable = {
    schema: "website-design-compiler/technology-convergence-receipt/v1" as const,
    candidateIdentitySha256: candidate.candidateIdentitySha256,
    buildSubjectSha256: sbom.buildSubjectSha256,
    sbomEvidenceIdentitySha256: sbom.evidenceIdentitySha256,
    componentBomRef: component.bomRef,
    spdxEvaluationIdentitySha256: spdx.evaluationIdentitySha256,
    policyState: spdx.state,
    engineeringDecision: admission.decision,
    humanLegalState: "NOT_EVALUATED" as const,
    admissionIdentitySha256: admission.admissionIdentitySha256,
    rightsEvidenceSha256
  };
  const receipt: TechnologyConvergenceReceipt = {
    ...stable,
    evaluatedAt,
    receiptIdentitySha256: digest(stable)
  };
  return { admission, spdx, receipt };
}

export function createConvergedTechnologyRevocation(
  receipt: TechnologyConvergenceReceipt,
  observedChangeSha256: string,
  reason: string,
  revokedAt: string
): TechnologyRevocation {
  return createTechnologyRevocation({
    candidateIdentitySha256: receipt.candidateIdentitySha256,
    admissionIdentitySha256: receipt.admissionIdentitySha256,
    observedChangeSha256: exactSha256(observedChangeSha256, "observedChangeSha256"),
    reason,
    revokedAt
  });
}
