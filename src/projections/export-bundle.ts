import { createHash } from "node:crypto";

export type ProjectionAccessClassification = "PUBLIC" | "INTERNAL" | "PRIVATE" | "PROTECTED";
export type ProjectionRecordKind = "ARCHITECTURE" | "DECISION" | "PROMPT" | "SOURCE" | "TECHNOLOGY" | "ISSUE" | "PULL_REQUEST" | "EVIDENCE" | "HANDOFF" | "OTHER";
export type ProjectionDriftState = "CURRENT" | "DRIFTED" | "UNKNOWN";
export type ProjectionScalar = string | number | boolean | null;

export interface ProjectionRecord {
  id: string;
  kind: ProjectionRecordKind;
  title: string;
  sourceUri: string;
  sourceSha256: string;
  accessClassification: ProjectionAccessClassification;
  fields: Record<string, ProjectionScalar>;
}

export interface ProjectionExportInput {
  bundleId: string;
  templateVersion: string;
  allowedAccessClassifications: readonly ProjectionAccessClassification[];
  records: readonly ProjectionRecord[];
  generatedAt: string;
}

export interface ProjectionOutputArtifact {
  mediaType: "text/markdown" | "text/csv" | "application/json";
  content: string;
  contentSha256: string;
}

export interface ProjectionExportBundle {
  schema: "website-design-compiler/projection-export-bundle/v1";
  bundleId: string;
  templateVersion: string;
  allowedAccessClassifications: ProjectionAccessClassification[];
  sourceSetSha256: string;
  recordCount: number;
  records: ProjectionRecord[];
  outputs: {
    markdown: ProjectionOutputArtifact;
    csv: ProjectionOutputArtifact;
    json: ProjectionOutputArtifact;
  };
  generatedAt: string;
  bundleIdentitySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const ACCESS = new Set<ProjectionAccessClassification>(["PUBLIC", "INTERNAL", "PRIVATE", "PROTECTED"]);
const KINDS = new Set<ProjectionRecordKind>(["ARCHITECTURE", "DECISION", "PROMPT", "SOURCE", "TECHNOLOGY", "ISSUE", "PULL_REQUEST", "EVIDENCE", "HANDOFF", "OTHER"]);

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("projection values cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`canonical JSON does not support ${typeof value}`);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be non-empty`);
  if (/[\u0000\r\n]/.test(normalized)) throw new Error(`${field} must be one public-safe line`);
  return normalized;
}

function stableId(value: string, field: string): string {
  const normalized = nonEmpty(value, field);
  if (!ID.test(normalized)) throw new Error(`${field} must use lowercase stable identifier characters`);
  return normalized;
}

function exactTimestamp(value: string): string {
  const normalized = nonEmpty(value, "generatedAt");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) throw new Error("generatedAt must be an exact ISO-8601 UTC timestamp");
  return normalized;
}

function safeSourceUri(value: string): string {
  const normalized = nonEmpty(value, "sourceUri");
  if (/^(?:file:|\/|~\/|[a-z]:[\\/])/i.test(normalized) || normalized.includes("\\") || normalized.includes("../")) {
    throw new Error("sourceUri must not contain a local or traversal path");
  }
  if (normalized.includes("://")) {
    let url: URL;
    try { url = new URL(normalized); } catch { throw new Error("sourceUri URL is malformed"); }
    if (url.protocol !== "https:") throw new Error("sourceUri network URLs must use HTTPS");
    if (url.username || url.password) throw new Error("sourceUri must not contain credentials");
    if (url.search) throw new Error("sourceUri must not contain query data");
  }
  return normalized;
}

function normalizeFields(fields: Record<string, ProjectionScalar>): Record<string, ProjectionScalar> {
  const normalized: Record<string, ProjectionScalar> = {};
  for (const key of Object.keys(fields).sort()) {
    const safeKey = nonEmpty(key, "fields key");
    const value = fields[key];
    if (value === undefined) throw new Error(`projection field ${safeKey} cannot be undefined`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`projection field ${safeKey} cannot be non-finite`);
    if (typeof value === "string" && /\u0000/.test(value)) throw new Error(`projection field ${safeKey} cannot contain NUL`);
    normalized[safeKey] = value;
  }
  return normalized;
}

function normalizeRecord(record: ProjectionRecord): ProjectionRecord {
  if (!KINDS.has(record.kind)) throw new Error(`projection record kind is invalid: ${record.kind}`);
  if (!ACCESS.has(record.accessClassification)) throw new Error(`projection access classification is invalid: ${record.accessClassification}`);
  return {
    id: stableId(record.id, "record.id"),
    kind: record.kind,
    title: nonEmpty(record.title, "record.title"),
    sourceUri: safeSourceUri(record.sourceUri),
    sourceSha256: exactSha256(record.sourceSha256, "record.sourceSha256"),
    accessClassification: record.accessClassification,
    fields: normalizeFields(record.fields)
  };
}

function normalizeAllowed(values: readonly ProjectionAccessClassification[]): ProjectionAccessClassification[] {
  if (values.length === 0) throw new Error("projection export requires at least one allowed access classification");
  const normalized = [...new Set(values)];
  for (const value of normalized) if (!ACCESS.has(value)) throw new Error(`allowed access classification is invalid: ${value}`);
  return normalized.sort();
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function renderCsv(records: readonly ProjectionRecord[]): string {
  const header = ["id", "kind", "title", "sourceUri", "sourceSha256", "accessClassification", "fieldsJson"];
  const rows = records.map((record) => [
    record.id,
    record.kind,
    record.title,
    record.sourceUri,
    record.sourceSha256,
    record.accessClassification,
    canonicalJson(record.fields)
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function renderMarkdown(bundleId: string, templateVersion: string, sourceSetSha256: string, records: readonly ProjectionRecord[]): string {
  const rows = records.map((record) => `| ${markdownCell(record.id)} | ${record.kind} | ${markdownCell(record.title)} | ${record.accessClassification} | ${markdownCell(record.sourceUri)} | \`${record.sourceSha256}\` |`);
  return [
    `# Projection Export — ${bundleId}`,
    "",
    `Template: \`${templateVersion}\``,
    `Source set: \`sha256:${sourceSetSha256}\``,
    "",
    "| ID | Kind | Title | Access | Canonical source | Source SHA-256 |",
    "|---|---|---|---|---|---|",
    ...rows,
    ""
  ].join("\n");
}

function output(mediaType: ProjectionOutputArtifact["mediaType"], content: string): ProjectionOutputArtifact {
  return { mediaType, content, contentSha256: sha256(content) };
}

export function createProjectionExportBundle(input: ProjectionExportInput): ProjectionExportBundle {
  const bundleId = stableId(input.bundleId, "bundleId");
  const templateVersion = nonEmpty(input.templateVersion, "templateVersion");
  const generatedAt = exactTimestamp(input.generatedAt);
  const allowedAccessClassifications = normalizeAllowed(input.allowedAccessClassifications);
  if (input.records.length === 0) throw new Error("projection export requires at least one canonical record");
  const records = input.records.map(normalizeRecord).sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`duplicate projection record id: ${record.id}`);
    ids.add(record.id);
    if (!allowedAccessClassifications.includes(record.accessClassification)) {
      throw new Error(`record ${record.id} access ${record.accessClassification} is not admitted for this export`);
    }
  }

  const sourceSetSha256 = sha256(canonicalJson(records.map((record) => ({ id: record.id, sourceUri: record.sourceUri, sourceSha256: record.sourceSha256, accessClassification: record.accessClassification }))));
  const jsonContent = `${canonicalJson({ schema: "website-design-compiler/projection-record-set/v1", bundleId, templateVersion, sourceSetSha256, records })}\n`;
  const markdownContent = renderMarkdown(bundleId, templateVersion, sourceSetSha256, records);
  const csvContent = renderCsv(records);
  const outputs = {
    markdown: output("text/markdown", markdownContent),
    csv: output("text/csv", csvContent),
    json: output("application/json", jsonContent)
  };
  const stable = {
    schema: "website-design-compiler/projection-export-bundle/v1" as const,
    bundleId,
    templateVersion,
    allowedAccessClassifications,
    sourceSetSha256,
    recordCount: records.length,
    records,
    outputs
  };
  return { ...stable, generatedAt, bundleIdentitySha256: sha256(canonicalJson(stable)) };
}

export function projectionDriftState(currentSourceSetSha256: string, projectedSourceSetSha256: string | null): ProjectionDriftState {
  const current = exactSha256(currentSourceSetSha256, "currentSourceSetSha256");
  if (projectedSourceSetSha256 === null) return "UNKNOWN";
  return current === exactSha256(projectedSourceSetSha256, "projectedSourceSetSha256") ? "CURRENT" : "DRIFTED";
}
