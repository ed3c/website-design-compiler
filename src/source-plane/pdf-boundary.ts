import { canonicalJsonSha256, type AccessClassification } from "./manifest.js";

export type PdfExecutionState = "NOT_EXERCISED";

export interface PdfSourceRequestInput {
  sourceId: string;
  locator: string;
  contentSha256: string;
  byteLength: number;
  accessClassification: AccessClassification;
  publicationClassification: "DIGEST_ONLY";
  extractionPolicySha256: string;
  requestedParserAdmissionIdentitySha256: string | null;
  capturedAt: string;
}

export interface PdfSourceRequest {
  schema: "website-design-compiler/pdf-source-request/v1";
  sourceId: string;
  sourceClass: "PDF";
  locator: string;
  mediaType: "application/pdf";
  accessClassification: AccessClassification;
  publicationClassification: "DIGEST_ONLY";
  subject: {
    kind: "DIGEST_ONLY_BYTES";
    byteLength: number;
    contentSha256: string;
  };
  extractionPolicySha256: string;
  requestedParserAdmissionIdentitySha256: string | null;
  capturedAt: string;
  requestIdentitySha256: string;
}

export interface PdfParseReceipt {
  schema: "website-design-compiler/pdf-parse-receipt/v1";
  requestIdentitySha256: string;
  sourceId: string;
  sourceClass: "PDF";
  parserAdmissionIdentitySha256: null;
  state: PdfExecutionState;
  reason: "PARSER_ADMISSION_ABSENT";
  observations: [];
  parserOutputSha256: null;
  publicText: null;
  evaluatedAt: string;
  receiptIdentitySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const ACCESS = new Set<AccessClassification>(["PUBLIC", "PRIVATE", "USER_PROVIDED", "PROTECTED"]);

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be non-empty`);
  return normalized;
}

function exactSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function exactTimestamp(value: string, field: string): string {
  const normalized = nonEmpty(value, field);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) {
    throw new Error(`${field} must be an exact ISO-8601 UTC timestamp`);
  }
  return normalized;
}

function sourceId(value: string): string {
  const normalized = nonEmpty(value, "sourceId");
  if (!SOURCE_ID.test(normalized)) throw new Error("sourceId must use lowercase stable identifier characters");
  return normalized;
}

function publicSafeLocator(value: string): string {
  const normalized = nonEmpty(value, "locator");
  if (
    /[\u0000\r\n]/.test(normalized) ||
    /^(?:file:|\/|~\/|[a-z]:[\\/])/i.test(normalized) ||
    normalized.includes("\\") ||
    normalized.includes("../") ||
    normalized.includes("://")
  ) {
    throw new Error("locator must be opaque and public-safe; local paths and network URLs are forbidden");
  }
  return normalized;
}

export function createPdfSourceRequest(input: PdfSourceRequestInput): PdfSourceRequest {
  if (!ACCESS.has(input.accessClassification)) throw new Error("accessClassification is invalid");
  if (input.publicationClassification !== "DIGEST_ONLY") {
    throw new Error("parser-neutral PDF boundary accepts DIGEST_ONLY publication only");
  }
  if (!Number.isInteger(input.byteLength) || input.byteLength < 1) {
    throw new Error("byteLength must be a positive integer");
  }
  const stable = {
    schema: "website-design-compiler/pdf-source-request/v1" as const,
    sourceId: sourceId(input.sourceId),
    sourceClass: "PDF" as const,
    locator: publicSafeLocator(input.locator),
    mediaType: "application/pdf" as const,
    accessClassification: input.accessClassification,
    publicationClassification: "DIGEST_ONLY" as const,
    subject: {
      kind: "DIGEST_ONLY_BYTES" as const,
      byteLength: input.byteLength,
      contentSha256: exactSha256(input.contentSha256, "contentSha256")
    },
    extractionPolicySha256: exactSha256(input.extractionPolicySha256, "extractionPolicySha256"),
    requestedParserAdmissionIdentitySha256: input.requestedParserAdmissionIdentitySha256 === null
      ? null
      : exactSha256(input.requestedParserAdmissionIdentitySha256, "requestedParserAdmissionIdentitySha256")
  };
  return {
    ...stable,
    capturedAt: exactTimestamp(input.capturedAt, "capturedAt"),
    requestIdentitySha256: canonicalJsonSha256(stable)
  };
}

export function createPdfNotExercisedReceipt(request: PdfSourceRequest, evaluatedAt: string): PdfParseReceipt {
  if (request.schema !== "website-design-compiler/pdf-source-request/v1") throw new Error("PDF request schema is invalid");
  if (request.requestedParserAdmissionIdentitySha256 !== null) {
    throw new Error("NOT_EXERCISED receipt is only valid while parser admission is absent");
  }
  const stable = {
    schema: "website-design-compiler/pdf-parse-receipt/v1" as const,
    requestIdentitySha256: exactSha256(request.requestIdentitySha256, "requestIdentitySha256"),
    sourceId: sourceId(request.sourceId),
    sourceClass: "PDF" as const,
    parserAdmissionIdentitySha256: null,
    state: "NOT_EXERCISED" as const,
    reason: "PARSER_ADMISSION_ABSENT" as const,
    observations: [] as [],
    parserOutputSha256: null,
    publicText: null
  };
  return {
    ...stable,
    evaluatedAt: exactTimestamp(evaluatedAt, "evaluatedAt"),
    receiptIdentitySha256: canonicalJsonSha256(stable)
  };
}
