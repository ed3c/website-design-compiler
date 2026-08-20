import {
  canonicalJsonSha256,
  createByteSourceManifest,
  sha256Bytes,
  type AccessClassification,
  type ParserIdentity,
  type PublicationClassification,
  type SourceManifest
} from "./manifest.js";
import { createSourceObservation, type SourceObservation } from "./observations.js";

export type ArticleObservationMode = "HASH_ONLY" | "EXCERPT";

export interface ArticleAdapterInput {
  sourceId: string;
  locator: string;
  mediaType: string;
  bytes: Uint8Array;
  accessClassification: AccessClassification;
  publicationClassification: PublicationClassification;
  capturedAt: string;
  observationMode?: ArticleObservationMode;
  maxExcerptCharacters?: number;
}

export interface ArticleAdapterResult {
  manifest: SourceManifest;
  observations: SourceObservation[];
  lineCount: number;
  sectionCount: number;
}

interface ArticleSection {
  startLine: number;
  endLine: number;
}

const SUPPORTED_MEDIA_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const DEFAULT_MAX_EXCERPT_CHARACTERS = 240;
const MAX_EXCERPT_CHARACTERS = 1000;

const ARTICLE_PARSER_CONFIG = {
  schema: "website-design-compiler/builtin-article-parser-config/v1",
  encoding: "utf-8",
  invalidUtf8: "FAIL",
  lineNormalization: "CRLF_AND_CR_TO_LF",
  markdownSections: "ATX_HEADINGS",
  plainTextSections: "WHOLE_DOCUMENT",
  supportedMediaTypes: [...SUPPORTED_MEDIA_TYPES].sort()
} as const;

export const ARTICLE_PARSER_IDENTITY: ParserIdentity = {
  name: "builtin-article-structure",
  version: "1",
  configSha256: canonicalJsonSha256(ARTICLE_PARSER_CONFIG)
};

function normalizeMediaType(mediaType: string): string {
  return mediaType.trim().toLowerCase();
}

function normalizeMode(mode: ArticleObservationMode | undefined): ArticleObservationMode {
  return mode ?? "HASH_ONLY";
}

function normalizeExcerptLimit(value: number | undefined): number {
  const normalized = value ?? DEFAULT_MAX_EXCERPT_CHARACTERS;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_EXCERPT_CHARACTERS) {
    throw new Error(`maxExcerptCharacters must be an integer from 1 through ${MAX_EXCERPT_CHARACTERS}`);
  }
  return normalized;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
  } catch {
    throw new Error("article bytes must contain valid UTF-8 text");
  }
}

function articleSections(lines: string[], mediaType: string): ArticleSection[] {
  if (mediaType === "text/plain") return [{ startLine: 1, endLine: lines.length }];

  const headingLines = lines
    .map((line, index) => (/^#{1,6}\s+\S/.test(line) ? index + 1 : null))
    .filter((value): value is number => value !== null);

  if (headingLines.length === 0) return [{ startLine: 1, endLine: lines.length }];

  const sections: ArticleSection[] = [];
  if (headingLines[0] !== 1) sections.push({ startLine: 1, endLine: headingLines[0]! - 1 });
  for (const [index, startLine] of headingLines.entries()) {
    const next = headingLines[index + 1];
    sections.push({ startLine, endLine: next === undefined ? lines.length : next - 1 });
  }
  return sections.filter((section) => section.endLine >= section.startLine);
}

function selectedEvidenceBytes(lines: string[], section: ArticleSection): Uint8Array {
  return new TextEncoder().encode(lines.slice(section.startLine - 1, section.endLine).join("\n"));
}

function boundedExcerpt(bytes: Uint8Array, maxCharacters: number): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim().replace(/\s+/g, " ");
  if (text.length === 0) throw new Error("article section cannot emit an empty excerpt");
  return text.length <= maxCharacters ? text : `${text.slice(0, maxCharacters - 1)}…`;
}

export function adaptArticle(input: ArticleAdapterInput): ArticleAdapterResult {
  const mediaType = normalizeMediaType(input.mediaType);
  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
    throw new Error(`unsupported article media type: ${mediaType || "EMPTY"}`);
  }

  const mode = normalizeMode(input.observationMode);
  const maxExcerptCharacters = normalizeExcerptLimit(input.maxExcerptCharacters);
  if (mode === "EXCERPT" && input.publicationClassification !== "PUBLIC_BYTES") {
    throw new Error("article EXCERPT observations require PUBLIC_BYTES publication classification");
  }

  const text = decodeUtf8(input.bytes);
  if (text.trim().length === 0) throw new Error("article text must contain non-whitespace content");
  const lines = text.split("\n");
  const sections = articleSections(lines, mediaType);
  const extractionPolicySha256 = canonicalJsonSha256({
    schema: "website-design-compiler/article-extraction-policy/v1",
    parserConfigSha256: ARTICLE_PARSER_IDENTITY.configSha256,
    observationMode: mode,
    maxExcerptCharacters: mode === "EXCERPT" ? maxExcerptCharacters : null
  });

  const manifest = createByteSourceManifest({
    sourceId: input.sourceId,
    sourceClass: "ARTICLE",
    locator: input.locator,
    mediaType,
    bytes: input.bytes,
    accessClassification: input.accessClassification,
    publicationClassification: input.publicationClassification,
    parser: ARTICLE_PARSER_IDENTITY,
    extractionPolicySha256,
    capturedAt: input.capturedAt,
    warnings: sections.length === 1 && mediaType !== "text/plain" && !/^#{1,6}\s+\S/m.test(text)
      ? ["markdown source contains no ATX headings; treated as one document section"]
      : []
  });

  const observations = sections.map((section, index) => {
    const evidenceBytes = selectedEvidenceBytes(lines, section);
    const evidenceSha256 = sha256Bytes(evidenceBytes);
    const statement = mode === "EXCERPT"
      ? boundedExcerpt(evidenceBytes, maxExcerptCharacters)
      : `article section ${index + 1} evidence sha256:${evidenceSha256}`;
    return createSourceObservation({
      sourceIdentitySha256: manifest.sourceIdentitySha256,
      statement,
      anchors: [{ kind: "LINES", startLine: section.startLine, endLine: section.endLine }],
      evidenceBytes,
      parser: ARTICLE_PARSER_IDENTITY
    });
  });

  return { manifest, observations, lineCount: lines.length, sectionCount: sections.length };
}
