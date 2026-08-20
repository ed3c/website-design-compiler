import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { validateAgainstSchema } from "./validate.js";

type JsonRecord = Record<string, unknown>;

export const GENERATED_PAGE_BROWSER_TRUST_SOURCE_PATHS = [
  ".github/workflows/compiler-core.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "playwright.config.ts",
  "playwright.runtime.config.ts",
  "schemas/generated-page-browser-admission-v1.schema.json",
  "schemas/generated-page-visual-observation.schema.json",
  "schemas/generated-page-browser-receipt-v3.schema.json",
  "schemas/design-quality-browser-observation.schema.json",
  "scripts/generated-page-browser-receipt.ts",
  "scripts/complete-page-graph-receipt.ts",
  "src/production-site-compiler.ts",
  "src/responsive-composition.ts",
  "apps/site/app/globals.css",
  "apps/site/app/benchmarks/[category]/page.tsx",
  "apps/site/components/sections/generated-page.tsx",
  "apps/site/components/sections/generated-section-stage.tsx",
  "apps/site/components/sections/governed-section.tsx",
  "apps/site/components/sections/governed-section.module.css",
  "tests/browser/design-quality-observations.spec.ts",
  "src/generated-page-browser-admission.ts",
  "src/css-color.ts",
  "src/png-evidence.ts",
  "src/release-evidence.ts",
  "src/validate.ts",
  "tests/browser/generated-pages.spec.ts"
] as const;

export const GENERATED_PAGE_CANONICAL_VIEWPORTS = {
  "desktop-chromium": { width: 1440, height: 1000 },
  "mobile-chromium": { width: 412, height: 839 }
} as const;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveWorkspacePath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error("generated-page browser trust paths must be workspace-relative");
  const resolved = resolve(root, path);
  const traversal = relative(root, resolved);
  if (traversal.split(/[\\/]/)[0] === ".." || isAbsolute(traversal)) {
    throw new Error("generated-page browser trust path escapes the workspace");
  }
  return resolved;
}

function evidenceSetSha256(receipt: JsonRecord, fields: readonly string[]): string | null {
  if (!Array.isArray(receipt.evidence)) return null;
  const entries: JsonRecord[] = [];
  for (const value of receipt.evidence) {
    if (!isRecord(value) || !fields.every((field) => typeof value[field] === "string")) return null;
    entries.push(Object.fromEntries(["category", "project", ...fields].map((field) => [field, value[field]])));
  }
  entries.sort((left, right) => `${String(left.category)}\0${String(left.project)}`.localeCompare(`${String(right.category)}\0${String(right.project)}`));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function generatedPageScreenshotSetSha256(receipt: JsonRecord): string | null {
  return evidenceSetSha256(receipt, ["path", "sha256"]);
}

export function generatedPageObservationSetSha256(receipt: JsonRecord): string | null {
  if (!Array.isArray(receipt.qualityEvidence)) return null;
  const entries: JsonRecord[] = [];
  for (const value of receipt.qualityEvidence) {
    if (!isRecord(value) || !["category", "project", "viewport", "path", "sha256", "screenshotSha256"].every((field) => typeof value[field] === "string")) return null;
    entries.push(Object.fromEntries(["category", "project", "viewport", "path", "sha256", "screenshotSha256"].map((field) => [field, value[field]])));
  }
  entries.sort((left, right) => `${String(left.category)}\0${String(left.project)}`.localeCompare(`${String(right.category)}\0${String(right.project)}`));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export async function generatedPageBrowserTrustSourceSha256(root = process.cwd()): Promise<string> {
  const digest = createHash("sha256");
  for (const path of GENERATED_PAGE_BROWSER_TRUST_SOURCE_PATHS) {
    digest.update(path);
    digest.update("\0");
    digest.update(await readFile(resolveWorkspacePath(root, path)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

export async function validateTrustedGeneratedPageBrowserAdmission(
  root: string,
  generatedReceiptBytes: Buffer,
  generatedReceipt: JsonRecord,
  expectedGit: { sha: string; ref: string }
): Promise<string[]> {
  const errors: string[] = [];
  const encodedAdmission = process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_BASE64?.trim();
  if (!encodedAdmission) return ["trusted generated-page browser admission is absent from the protected external channel"];
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encodedAdmission, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== encodedAdmission) throw new Error("non-canonical base64");
  } catch {
    return ["trusted generated-page browser admission external bytes are malformed"];
  }
  const receiptSha256 = createHash("sha256").update(bytes).digest("hex");
  const trustedSha256 = process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_SHA256?.trim();
  if (!trustedSha256 || trustedSha256 !== receiptSha256) {
    errors.push("generated-page browser admission does not match the externally trusted SHA-256");
  }
  let admission: JsonRecord;
  try {
    admission = JSON.parse(bytes.toString("utf8")) as JsonRecord;
    await validateAgainstSchema(admission, "generated-page-browser-admission-v1.schema.json");
  } catch (error) {
    errors.push(`generated-page browser admission is malformed: ${error instanceof Error ? error.message : String(error)}`);
    return errors;
  }
  const subject = isRecord(admission.subject) ? admission.subject : null;
  if (!subject || subject.sha !== expectedGit.sha || subject.ref !== expectedGit.ref) {
    errors.push("generated-page browser admission does not bind the premium Git subject");
  }
  if (admission.generatedPageReceiptSha256 !== createHash("sha256").update(generatedReceiptBytes).digest("hex")) {
    errors.push("generated-page browser admission does not bind the generated-page receipt bytes");
  }
  const screenshotSetSha256 = generatedPageScreenshotSetSha256(generatedReceipt);
  if (!screenshotSetSha256 || admission.screenshotSetSha256 !== screenshotSetSha256) {
    errors.push("generated-page browser admission does not bind the screenshot set");
  }
  const observationSetSha256 = generatedPageObservationSetSha256(generatedReceipt);
  if (!observationSetSha256 || admission.observationSetSha256 !== observationSetSha256) {
    errors.push("generated-page browser admission does not bind the visual observation set");
  }
  try {
    if (admission.sourceFilesSha256 !== await generatedPageBrowserTrustSourceSha256(root)) {
      errors.push("generated-page browser admission does not bind the current producer and verifier sources");
    }
  } catch {
    errors.push("generated-page browser trust sources are missing or unreadable");
  }
  return errors;
}
