import {
  canonicalJsonSha256,
  isSha256,
  normalizeParserIdentity,
  normalizeRepositoryPath,
  sha256Bytes,
  type ParserIdentity
} from "./manifest.js";

export type SourceAnchor =
  | { kind: "PAGE"; page: number; startLine?: number; endLine?: number }
  | { kind: "LINES"; startLine: number; endLine: number }
  | { kind: "GIT_PATH"; path: string; startLine?: number; endLine?: number }
  | { kind: "SECTION"; heading: string };

export interface SourceObservation {
  schema: "website-design-compiler/source-observation/v1";
  claimClass: "OBSERVATION";
  observationId: string;
  sourceIdentitySha256: string;
  statement: string;
  anchors: SourceAnchor[];
  evidenceSha256: string;
  parser: ParserIdentity;
  observationIdentitySha256: string;
  warnings: string[];
}

export interface SourceInferenceRecord {
  schema: "website-design-compiler/source-inference/v1";
  claimClass: "INFERENCE";
  inferenceId: string;
  statement: string;
  basisObservationIdentitySha256: string[];
  modelIdentity: string;
  inferenceIdentitySha256: string;
}

export interface SourceObservationInput {
  sourceIdentitySha256: string;
  statement: string;
  anchors: readonly SourceAnchor[];
  evidenceBytes: Uint8Array;
  parser: ParserIdentity;
  warnings?: readonly string[];
}

export interface SourceInferenceInput {
  statement: string;
  basisObservationIdentitySha256: readonly string[];
  modelIdentity: string;
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must be non-empty`);
  return normalized;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function normalizeOptionalLineRange(
  startLine: number | undefined,
  endLine: number | undefined,
  field: string
): { startLine?: number; endLine?: number } {
  if (startLine === undefined && endLine === undefined) return {};
  if (startLine === undefined || endLine === undefined) throw new Error(`${field} startLine and endLine must be supplied together`);
  const start = requirePositiveInteger(startLine, `${field}.startLine`);
  const end = requirePositiveInteger(endLine, `${field}.endLine`);
  if (end < start) throw new Error(`${field}.endLine must be greater than or equal to startLine`);
  return { startLine: start, endLine: end };
}

function normalizeAnchor(anchor: SourceAnchor): SourceAnchor {
  if (anchor.kind === "PAGE") {
    return {
      kind: "PAGE",
      page: requirePositiveInteger(anchor.page, "anchor.page"),
      ...normalizeOptionalLineRange(anchor.startLine, anchor.endLine, "anchor")
    };
  }
  if (anchor.kind === "LINES") {
    const range = normalizeOptionalLineRange(anchor.startLine, anchor.endLine, "anchor");
    if (range.startLine === undefined || range.endLine === undefined) throw new Error("line anchor requires a range");
    return { kind: "LINES", startLine: range.startLine, endLine: range.endLine };
  }
  if (anchor.kind === "GIT_PATH") {
    return {
      kind: "GIT_PATH",
      path: normalizeRepositoryPath(anchor.path),
      ...normalizeOptionalLineRange(anchor.startLine, anchor.endLine, "anchor")
    };
  }
  return { kind: "SECTION", heading: requireNonEmpty(anchor.heading, "anchor.heading") };
}

function normalizeWarnings(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => requireNonEmpty(value, "warning")))].sort();
}

export function createSourceObservation(input: SourceObservationInput): SourceObservation {
  const sourceIdentitySha256 = input.sourceIdentitySha256.trim().toLowerCase();
  if (!isSha256(sourceIdentitySha256)) throw new Error("sourceIdentitySha256 must be an exact SHA-256");
  if (input.evidenceBytes.byteLength === 0) throw new Error("observation evidence bytes must be non-empty");
  if (input.anchors.length === 0) throw new Error("observation requires at least one exact source anchor");

  const statement = requireNonEmpty(input.statement, "statement");
  const anchors = input.anchors.map((anchor) => normalizeAnchor(anchor));
  const parser = normalizeParserIdentity(input.parser);
  const evidenceSha256 = sha256Bytes(input.evidenceBytes);
  const warnings = normalizeWarnings(input.warnings);
  const observationIdentitySha256 = canonicalJsonSha256({
    schema: "website-design-compiler/source-observation/v1",
    claimClass: "OBSERVATION",
    sourceIdentitySha256,
    statement,
    anchors,
    evidenceSha256,
    parser
  });

  return {
    schema: "website-design-compiler/source-observation/v1",
    claimClass: "OBSERVATION",
    observationId: `obs-${observationIdentitySha256.slice(0, 20)}`,
    sourceIdentitySha256,
    statement,
    anchors,
    evidenceSha256,
    parser,
    observationIdentitySha256,
    warnings
  };
}

export function createSourceInferenceRecord(input: SourceInferenceInput): SourceInferenceRecord {
  const statement = requireNonEmpty(input.statement, "statement");
  const modelIdentity = requireNonEmpty(input.modelIdentity, "modelIdentity");
  const basis = [...new Set(input.basisObservationIdentitySha256.map((value) => value.trim().toLowerCase()))].sort();
  if (basis.length === 0) throw new Error("inference requires at least one observation identity");
  if (basis.some((value) => !isSha256(value))) throw new Error("inference basis must contain exact observation SHA-256 identities");

  const inferenceIdentitySha256 = canonicalJsonSha256({
    schema: "website-design-compiler/source-inference/v1",
    claimClass: "INFERENCE",
    statement,
    basisObservationIdentitySha256: basis,
    modelIdentity
  });
  return {
    schema: "website-design-compiler/source-inference/v1",
    claimClass: "INFERENCE",
    inferenceId: `inf-${inferenceIdentitySha256.slice(0, 20)}`,
    statement,
    basisObservationIdentitySha256: basis,
    modelIdentity,
    inferenceIdentitySha256
  };
}
