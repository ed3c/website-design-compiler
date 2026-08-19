import { createHash } from "node:crypto";

export type SourceClass =
  | "ARTICLE"
  | "PDF"
  | "URL"
  | "GIT_REPOSITORY"
  | "PACKAGE"
  | "MODEL"
  | "PROVIDER"
  | "ASSET"
  | "OTHER";

export type AccessClassification = "PUBLIC" | "PRIVATE" | "USER_PROVIDED" | "PROTECTED";
export type PublicationClassification = "PUBLIC_BYTES" | "DIGEST_ONLY" | "PRIVATE_FIXTURE" | "PROHIBITED";

export interface ParserIdentity {
  name: string;
  version: string;
  configSha256: string;
}

export interface ByteSourceSubject {
  kind: "BYTES";
  mediaType: string;
  byteLength: number;
  contentSha256: string;
}

export interface UrlRedirect {
  status: number;
  fromUrl: string;
  toUrl: string;
}

export interface UrlCaptureSourceSubject {
  kind: "URL_CAPTURE";
  mediaType: string;
  byteLength: number;
  contentSha256: string;
  requestedUrl: string;
  finalUrl: string;
  redirectChain: UrlRedirect[];
}

export interface GitSourceSubject {
  kind: "GIT";
  repository: string;
  commit: string;
  tree: string;
  paths: string[];
}

export type SourceSubject = ByteSourceSubject | UrlCaptureSourceSubject | GitSourceSubject;

export interface SourceManifest {
  schema: "website-design-compiler/source-manifest/v1";
  sourceId: string;
  sourceClass: SourceClass;
  locator: string;
  accessClassification: AccessClassification;
  publicationClassification: PublicationClassification;
  parser: ParserIdentity;
  extractionPolicySha256: string;
  capturedAt: string;
  subject: SourceSubject;
  sourceIdentitySha256: string;
  warnings: string[];
}

interface CommonSourceInput {
  sourceId: string;
  accessClassification: AccessClassification;
  publicationClassification: PublicationClassification;
  parser: ParserIdentity;
  extractionPolicySha256: string;
  capturedAt: string;
  warnings?: readonly string[];
}

export interface ByteSourceInput extends CommonSourceInput {
  sourceClass: Exclude<SourceClass, "URL" | "GIT_REPOSITORY">;
  locator: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface UrlCaptureSourceInput extends CommonSourceInput {
  mediaType: string;
  bytes: Uint8Array;
  requestedUrl: string;
  finalUrl: string;
  redirectChain?: readonly UrlRedirect[];
}

export interface GitSourceInput extends CommonSourceInput {
  repository: string;
  commit: string;
  tree: string;
  paths: readonly string[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

export function isSha256(value: string): boolean {
  return SHA256_PATTERN.test(value);
}

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`canonical JSON does not support ${typeof value}`);
}

export function canonicalJsonSha256(value: unknown): string {
  return sha256Bytes(canonicalJson(value));
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must be non-empty`);
  return normalized;
}

function requireSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function requireGitSha(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GIT_SHA_PATTERN.test(normalized)) throw new Error(`${field} must be an exact 40-character Git SHA`);
  return normalized;
}

function normalizeSourceId(value: string): string {
  const normalized = value.trim();
  if (!SOURCE_ID_PATTERN.test(normalized)) {
    throw new Error("sourceId must use lowercase stable identifier characters and be 3-128 characters");
  }
  return normalized;
}

function normalizeCapturedAt(value: string): string {
  const normalized = requireNonEmpty(value, "capturedAt");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) {
    throw new Error("capturedAt must be an exact ISO-8601 UTC timestamp");
  }
  return normalized;
}

function normalizeWarnings(values: readonly string[] | undefined): string[] {
  const warnings = (values ?? []).map((value) => requireNonEmpty(value, "warning"));
  return [...new Set(warnings)].sort();
}

export function normalizeParserIdentity(parser: ParserIdentity): ParserIdentity {
  return {
    name: requireNonEmpty(parser.name, "parser.name"),
    version: requireNonEmpty(parser.version, "parser.version"),
    configSha256: requireSha256(parser.configSha256, "parser.configSha256")
  };
}

function normalizeMediaType(mediaType: string): string {
  const normalized = requireNonEmpty(mediaType, "mediaType").toLowerCase();
  if (!MEDIA_TYPE_PATTERN.test(normalized)) throw new Error("mediaType must be a valid type/subtype token");
  return normalized;
}

function validateMediaSignature(mediaType: string, bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new Error("source bytes must be non-empty");
  if (mediaType === "application/pdf") {
    const header = Buffer.from(bytes.subarray(0, 5)).toString("ascii");
    if (header !== "%PDF-") throw new Error("application/pdf bytes do not contain a PDF signature");
  }
}

function normalizeOpaqueLocator(locator: string): string {
  const normalized = requireNonEmpty(locator, "locator");
  if (
    /[\u0000\r\n]/.test(normalized) ||
    /^(?:file:|\/|~\/|[a-z]:[\\/])/i.test(normalized) ||
    normalized.includes("\\") ||
    normalized.includes("../") ||
    normalized.endsWith("/..") ||
    normalized.includes("://")
  ) {
    throw new Error("locator must be public-safe and must not contain a local path or network URL");
  }
  return normalized;
}

function normalizeHttpsUrl(raw: string, field: string): string {
  let url: URL;
  try {
    url = new URL(requireNonEmpty(raw, field));
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${field} must not contain credentials`);
  if (url.search || url.hash) throw new Error(`${field} must not contain query or fragment data in a public receipt`);
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error(`${field} must not identify a local host`);
  }
  return url.toString();
}

function normalizeGitRepository(raw: string): string {
  const normalized = normalizeHttpsUrl(raw, "repository");
  const url = new URL(normalized);
  if (url.hostname.toLowerCase() !== "github.com") throw new Error("repository must be a public GitHub HTTPS URL");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) throw new Error("repository must identify exactly one owner/repository pair");
  const owner = segments[0];
  const repo = segments[1]?.replace(/\.git$/i, "");
  if (!owner || !repo) throw new Error("repository owner/name is malformed");
  return `https://github.com/${owner}/${repo}`;
}

export function normalizeRepositoryPath(raw: string): string {
  const path = requireNonEmpty(raw, "repository path");
  if (path.startsWith("/") || path.includes("\\")) throw new Error("repository path must be relative POSIX form");
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("repository path must not contain empty, dot, or traversal segments");
  }
  return segments.join("/");
}

function normalizeCommon(input: CommonSourceInput): Omit<SourceManifest, "sourceClass" | "locator" | "subject" | "sourceIdentitySha256"> {
  return {
    schema: "website-design-compiler/source-manifest/v1",
    sourceId: normalizeSourceId(input.sourceId),
    accessClassification: input.accessClassification,
    publicationClassification: input.publicationClassification,
    parser: normalizeParserIdentity(input.parser),
    extractionPolicySha256: requireSha256(input.extractionPolicySha256, "extractionPolicySha256"),
    capturedAt: normalizeCapturedAt(input.capturedAt),
    warnings: normalizeWarnings(input.warnings)
  };
}

function sourceIdentityMaterial(manifest: Omit<SourceManifest, "sourceIdentitySha256">): unknown {
  const { capturedAt: _capturedAt, warnings: _warnings, ...stable } = manifest;
  return stable;
}

export function createByteSourceManifest(input: ByteSourceInput): SourceManifest {
  if (input.sourceClass === "URL" || input.sourceClass === "GIT_REPOSITORY") {
    throw new Error("byte source cannot use URL or GIT_REPOSITORY sourceClass");
  }
  const common = normalizeCommon(input);
  const mediaType = normalizeMediaType(input.mediaType);
  validateMediaSignature(mediaType, input.bytes);
  const subject: ByteSourceSubject = {
    kind: "BYTES",
    mediaType,
    byteLength: input.bytes.byteLength,
    contentSha256: sha256Bytes(input.bytes)
  };
  const withoutIdentity = {
    ...common,
    sourceClass: input.sourceClass,
    locator: normalizeOpaqueLocator(input.locator),
    subject
  } satisfies Omit<SourceManifest, "sourceIdentitySha256">;
  const identity = canonicalJsonSha256(sourceIdentityMaterial(withoutIdentity));
  return { ...withoutIdentity, sourceIdentitySha256: identity };
}

function normalizeRedirectChain(
  requestedUrl: string,
  finalUrl: string,
  chain: readonly UrlRedirect[] | undefined
): UrlRedirect[] {
  const normalized = (chain ?? []).map((entry) => {
    if (!Number.isInteger(entry.status) || entry.status < 300 || entry.status > 399) {
      throw new Error("redirect status must be an integer from 300 through 399");
    }
    return {
      status: entry.status,
      fromUrl: normalizeHttpsUrl(entry.fromUrl, "redirect.fromUrl"),
      toUrl: normalizeHttpsUrl(entry.toUrl, "redirect.toUrl")
    };
  });
  if (normalized.length === 0) {
    if (requestedUrl !== finalUrl) throw new Error("finalUrl differs from requestedUrl without a redirect chain");
    return normalized;
  }
  if (normalized[0]?.fromUrl !== requestedUrl) throw new Error("redirect chain does not start at requestedUrl");
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.toUrl !== normalized[index]?.fromUrl) {
      throw new Error("redirect chain is discontinuous");
    }
  }
  if (normalized.at(-1)?.toUrl !== finalUrl) throw new Error("redirect chain does not end at finalUrl");
  return normalized;
}

export function createUrlCaptureSourceManifest(input: UrlCaptureSourceInput): SourceManifest {
  const common = normalizeCommon(input);
  const mediaType = normalizeMediaType(input.mediaType);
  validateMediaSignature(mediaType, input.bytes);
  const requestedUrl = normalizeHttpsUrl(input.requestedUrl, "requestedUrl");
  const finalUrl = normalizeHttpsUrl(input.finalUrl, "finalUrl");
  const subject: UrlCaptureSourceSubject = {
    kind: "URL_CAPTURE",
    mediaType,
    byteLength: input.bytes.byteLength,
    contentSha256: sha256Bytes(input.bytes),
    requestedUrl,
    finalUrl,
    redirectChain: normalizeRedirectChain(requestedUrl, finalUrl, input.redirectChain)
  };
  const withoutIdentity = {
    ...common,
    sourceClass: "URL" as const,
    locator: finalUrl,
    subject
  } satisfies Omit<SourceManifest, "sourceIdentitySha256">;
  const identity = canonicalJsonSha256(sourceIdentityMaterial(withoutIdentity));
  return { ...withoutIdentity, sourceIdentitySha256: identity };
}

export function createGitSourceManifest(input: GitSourceInput): SourceManifest {
  const common = normalizeCommon(input);
  const repository = normalizeGitRepository(input.repository);
  const commit = requireGitSha(input.commit, "commit");
  const tree = requireGitSha(input.tree, "tree");
  const paths = [...new Set(input.paths.map((path) => normalizeRepositoryPath(path)))].sort();
  if (paths.length === 0) throw new Error("git source must select at least one exact repository path");
  const subject: GitSourceSubject = { kind: "GIT", repository, commit, tree, paths };
  const withoutIdentity = {
    ...common,
    sourceClass: "GIT_REPOSITORY" as const,
    locator: repository,
    subject
  } satisfies Omit<SourceManifest, "sourceIdentitySha256">;
  const identity = canonicalJsonSha256(sourceIdentityMaterial(withoutIdentity));
  return { ...withoutIdentity, sourceIdentitySha256: identity };
}

export function sourceBytesMayBePublished(manifest: SourceManifest): boolean {
  return manifest.publicationClassification === "PUBLIC_BYTES";
}
