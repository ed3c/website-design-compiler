import {
  canonicalJsonSha256,
  createGitSourceManifest,
  normalizeRepositoryPath,
  sha256Bytes,
  type AccessClassification,
  type ParserIdentity,
  type PublicationClassification,
  type SourceManifest
} from "./manifest.js";
import { createSourceObservation, type SourceObservation } from "./observations.js";

export type RepositoryObservationMode = "HASH_ONLY" | "EXCERPT";

export interface RepositoryFileSnapshot {
  path: string;
  bytes: Uint8Array;
}

export interface RepositoryObservationRange {
  path: string;
  startLine: number;
  endLine: number;
}

export interface RepositoryAdapterInput {
  sourceId: string;
  repository: string;
  commit: string;
  tree: string;
  files: readonly RepositoryFileSnapshot[];
  ranges: readonly RepositoryObservationRange[];
  accessClassification: AccessClassification;
  publicationClassification: PublicationClassification;
  capturedAt: string;
  observationMode?: RepositoryObservationMode;
  maxExcerptCharacters?: number;
}

export interface RepositoryAdapterResult {
  manifest: SourceManifest;
  observations: SourceObservation[];
  fileCount: number;
  rangeCount: number;
}

interface NormalizedFile {
  path: string;
  lines: string[];
}

interface NormalizedRange {
  path: string;
  startLine: number;
  endLine: number;
}

const DEFAULT_MAX_EXCERPT_CHARACTERS = 240;
const MAX_EXCERPT_CHARACTERS = 1000;
const REPOSITORY_PARSER_CONFIG = {
  schema: "website-design-compiler/builtin-repository-parser-config/v1",
  encoding: "utf-8",
  invalidUtf8: "FAIL",
  lineNormalization: "CRLF_AND_CR_TO_LF",
  acquisition: "CALLER_SUPPLIED_EXACT_GIT_SNAPSHOT",
  observationSelection: "EXPLICIT_PATH_LINE_RANGE"
} as const;

export const REPOSITORY_PARSER_IDENTITY: ParserIdentity = {
  name: "builtin-exact-repository-text",
  version: "1",
  configSha256: canonicalJsonSha256(REPOSITORY_PARSER_CONFIG)
};

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
  } catch {
    throw new Error(`repository file ${path} must contain valid UTF-8 text`);
  }
}

function normalizePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function normalizeExcerptLimit(value: number | undefined): number {
  const normalized = value ?? DEFAULT_MAX_EXCERPT_CHARACTERS;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_EXCERPT_CHARACTERS) {
    throw new Error(`maxExcerptCharacters must be an integer from 1 through ${MAX_EXCERPT_CHARACTERS}`);
  }
  return normalized;
}

function normalizeFiles(files: readonly RepositoryFileSnapshot[]): NormalizedFile[] {
  if (files.length === 0) throw new Error("repository adapter requires at least one supplied file snapshot");
  const seen = new Set<string>();
  const normalized = files.map((file) => {
    const path = normalizeRepositoryPath(file.path);
    if (seen.has(path)) throw new Error(`duplicate repository file snapshot: ${path}`);
    seen.add(path);
    const text = decodeUtf8(file.bytes, path);
    return { path, lines: text.split("\n") };
  });
  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeRanges(ranges: readonly RepositoryObservationRange[]): NormalizedRange[] {
  if (ranges.length === 0) throw new Error("repository adapter requires at least one explicit observation range");
  const normalized = ranges.map((range) => {
    const path = normalizeRepositoryPath(range.path);
    const startLine = normalizePositiveInteger(range.startLine, "range.startLine");
    const endLine = normalizePositiveInteger(range.endLine, "range.endLine");
    if (endLine < startLine) throw new Error("range.endLine must be greater than or equal to range.startLine");
    return { path, startLine, endLine };
  }).sort((left, right) => left.path.localeCompare(right.path) || left.startLine - right.startLine || left.endLine - right.endLine);

  const seen = new Set<string>();
  for (const range of normalized) {
    const key = `${range.path}:${range.startLine}:${range.endLine}`;
    if (seen.has(key)) throw new Error(`duplicate repository observation range: ${key}`);
    seen.add(key);
  }
  return normalized;
}

function selectedEvidenceBytes(file: NormalizedFile, range: NormalizedRange): Uint8Array {
  if (range.endLine > file.lines.length) {
    throw new Error(`repository observation range exceeds ${range.path} line count ${file.lines.length}`);
  }
  const evidence = file.lines.slice(range.startLine - 1, range.endLine).join("\n");
  const bytes = new TextEncoder().encode(evidence);
  if (bytes.byteLength === 0) throw new Error(`repository observation range for ${range.path} has empty evidence`);
  return bytes;
}

function boundedExcerpt(bytes: Uint8Array, maxCharacters: number): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim().replace(/\s+/g, " ");
  if (text.length === 0) throw new Error("repository range cannot emit an empty excerpt");
  return text.length <= maxCharacters ? text : `${text.slice(0, maxCharacters - 1)}…`;
}

export function adaptRepositorySnapshot(input: RepositoryAdapterInput): RepositoryAdapterResult {
  if (input.accessClassification !== "PUBLIC") {
    throw new Error("exact repository adapter is limited to PUBLIC GitHub subjects");
  }
  const mode = input.observationMode ?? "HASH_ONLY";
  const maxExcerptCharacters = normalizeExcerptLimit(input.maxExcerptCharacters);
  if (mode === "EXCERPT" && input.publicationClassification !== "PUBLIC_BYTES") {
    throw new Error("repository EXCERPT observations require PUBLIC_BYTES publication classification");
  }

  const files = normalizeFiles(input.files);
  const ranges = normalizeRanges(input.ranges);
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  for (const range of ranges) {
    if (!filesByPath.has(range.path)) throw new Error(`repository observation range selects unknown path: ${range.path}`);
  }

  const extractionPolicySha256 = canonicalJsonSha256({
    schema: "website-design-compiler/repository-extraction-policy/v1",
    parserConfigSha256: REPOSITORY_PARSER_IDENTITY.configSha256,
    observationMode: mode,
    maxExcerptCharacters: mode === "EXCERPT" ? maxExcerptCharacters : null,
    ranges
  });

  const manifest = createGitSourceManifest({
    sourceId: input.sourceId,
    repository: input.repository,
    commit: input.commit,
    tree: input.tree,
    paths: files.map((file) => file.path),
    accessClassification: input.accessClassification,
    publicationClassification: input.publicationClassification,
    parser: REPOSITORY_PARSER_IDENTITY,
    extractionPolicySha256,
    capturedAt: input.capturedAt
  });

  const observations = ranges.map((range) => {
    const file = filesByPath.get(range.path)!;
    const evidenceBytes = selectedEvidenceBytes(file, range);
    const evidenceSha256 = sha256Bytes(evidenceBytes);
    const statement = mode === "EXCERPT"
      ? boundedExcerpt(evidenceBytes, maxExcerptCharacters)
      : `repository ${range.path} lines ${range.startLine}-${range.endLine} evidence sha256:${evidenceSha256}`;
    return createSourceObservation({
      sourceIdentitySha256: manifest.sourceIdentitySha256,
      statement,
      anchors: [{ kind: "GIT_PATH", path: range.path, startLine: range.startLine, endLine: range.endLine }],
      evidenceBytes,
      parser: REPOSITORY_PARSER_IDENTITY
    });
  });

  return { manifest, observations, fileCount: files.length, rangeCount: ranges.length };
}
