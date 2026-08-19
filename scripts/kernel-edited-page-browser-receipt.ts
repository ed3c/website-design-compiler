import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateAgainstSchema } from "../src/validate.js";

type BrowserProject = "desktop-chromium" | "tablet-chromium" | "mobile-chromium" | "reduced-motion-chromium";
type KernelEditProof = {
  schema: "website-design-compiler/kernel-edited-page-browser-subject/v1";
  subjectHeadSha: string;
  category: string;
  route: string;
  sourceManifestIdentitySha256: string;
  sourceObservationIdentitySha256: string;
  basePageDigest: string;
  patchIdentitySha256: string;
  patchReceiptIdentitySha256: string;
  resultPageDigest: string;
  editedHeadline: string;
  site: {
    signature: string;
    routes: Array<{ route: string; page: { signature: string; nodes: Array<{ id: string }> } }>;
  };
};
type Observation = {
  schema: "website-design-compiler/kernel-edited-page-browser-observation/v1";
  browserProject: BrowserProject;
  subjectHeadSha: string;
  category: string;
  route: string;
  siteSignature: string;
  pageSignature: string;
  sourceManifestIdentitySha256: string;
  sourceObservationIdentitySha256: string;
  basePageDigest: string;
  patchIdentitySha256: string;
  patchReceiptIdentitySha256: string;
  resultPageDigest: string;
  editedHeadlineObserved: boolean;
  semanticNodeIds: Array<string | null>;
  noHorizontalOverflow: boolean;
  reducedMotion: boolean;
  viewport: { width: number; height: number } | null;
  screenshotPath: string;
  screenshotSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const expectedProjects: BrowserProject[] = [
  "desktop-chromium",
  "tablet-chromium",
  "mobile-chromium",
  "reduced-motion-chromium"
];

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("browser receipt cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`browser receipt canonical JSON does not support ${typeof value}`);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function currentCanonicalHead(): string {
  const headRef = process.env.GITHUB_HEAD_REF?.trim();
  const value = (headRef
    ? execFileSync("git", ["rev-parse", `refs/remotes/origin/${headRef}`], { encoding: "utf8" })
    : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
  ).trim().toLowerCase();
  if (!GIT_SHA.test(value)) throw new Error("canonical browser-proof head is not an exact Git SHA");
  return value;
}

function exactSha(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function exactHead(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GIT_SHA.test(normalized)) throw new Error(`${field} must be an exact 40-character Git SHA`);
  return normalized;
}

const root = process.cwd();
const browserRoot = join(root, "artifacts", "browser-qa");
const uploadedEvidenceRoot = join(browserRoot, "test-results-functional");
const projection = JSON.parse(await readFile(join(root, "apps", "site", "generated", "benchmark-page-graphs.json"), "utf8")) as { kernelEditProof?: KernelEditProof };
const proof = projection.kernelEditProof;
if (!proof || proof.schema !== "website-design-compiler/kernel-edited-page-browser-subject/v1") {
  throw new Error("kernel edited-page browser subject is absent from the generated projection");
}
const currentHead = currentCanonicalHead();
const failures: string[] = [];
if (exactHead(proof.subjectHeadSha, "proof.subjectHeadSha") !== currentHead) failures.push("proof subject head does not match the current canonical PR head");
for (const field of [
  "sourceManifestIdentitySha256",
  "sourceObservationIdentitySha256",
  "basePageDigest",
  "patchIdentitySha256",
  "patchReceiptIdentitySha256",
  "resultPageDigest"
] as const) exactSha(proof[field], `proof.${field}`);
const route = proof.site.routes.find((entry) => entry.route === proof.route);
if (!route) throw new Error("kernel edited-page browser subject route is absent from its site graph");
const expectedNodeIds = route.page.nodes.map((node) => node.id);

const observations: Array<{
  browserProject: BrowserProject;
  screenshotPath: string;
  screenshotSha256: string;
  screenshotByteLength: number;
  semanticNodeIds: string[];
  noHorizontalOverflow: boolean;
  reducedMotion: boolean;
  viewport: { width: number; height: number } | null;
  exactIdentityMatch: boolean;
}> = [];

for (const project of expectedProjects) {
  const evidencePath = join(uploadedEvidenceRoot, "kernel-edit-evidence", `${project}.json`);
  let observation: Observation;
  try {
    observation = JSON.parse(await readFile(evidencePath, "utf8")) as Observation;
  } catch (error) {
    failures.push(`${project}: browser observation is absent or unreadable: ${error instanceof Error ? error.message : "UNKNOWN"}`);
    continue;
  }
  const expectedScreenshotPath = `screenshots/kernel-edit--${project}.png`;
  const screenshotPath = observation.screenshotPath;
  let screenshotSha256 = "0".repeat(64);
  let screenshotByteLength = 0;
  try {
    if (screenshotPath !== expectedScreenshotPath) throw new Error("screenshot path does not match the project-owned path");
    const screenshot = await readFile(join(browserRoot, screenshotPath));
    screenshotByteLength = screenshot.byteLength;
    if (screenshotByteLength === 0) throw new Error("screenshot bytes are empty");
    screenshotSha256 = createHash("sha256").update(screenshot).digest("hex");
    if (screenshotSha256 !== observation.screenshotSha256) throw new Error("screenshot digest does not match browser-recorded bytes");
  } catch (error) {
    failures.push(`${project}: ${error instanceof Error ? error.message : "screenshot verification failed"}`);
  }
  const semanticNodeIds = observation.semanticNodeIds.filter((entry): entry is string => typeof entry === "string");
  const expectedReducedMotion = project === "reduced-motion-chromium";
  const exactIdentityMatch =
    observation.schema === "website-design-compiler/kernel-edited-page-browser-observation/v1" &&
    observation.browserProject === project &&
    observation.subjectHeadSha === proof.subjectHeadSha &&
    observation.category === proof.category &&
    observation.route === proof.route &&
    observation.siteSignature === proof.site.signature &&
    observation.pageSignature === route.page.signature &&
    observation.sourceManifestIdentitySha256 === proof.sourceManifestIdentitySha256 &&
    observation.sourceObservationIdentitySha256 === proof.sourceObservationIdentitySha256 &&
    observation.basePageDigest === proof.basePageDigest &&
    observation.patchIdentitySha256 === proof.patchIdentitySha256 &&
    observation.patchReceiptIdentitySha256 === proof.patchReceiptIdentitySha256 &&
    observation.resultPageDigest === proof.resultPageDigest &&
    observation.editedHeadlineObserved === true &&
    observation.noHorizontalOverflow === true &&
    observation.reducedMotion === expectedReducedMotion &&
    JSON.stringify(semanticNodeIds) === JSON.stringify(expectedNodeIds) &&
    screenshotSha256 === observation.screenshotSha256 &&
    screenshotByteLength > 0;
  if (!exactIdentityMatch) failures.push(`${project}: edited-page browser identity or behavioral evidence drift`);
  observations.push({
    browserProject: project,
    screenshotPath: expectedScreenshotPath,
    screenshotSha256,
    screenshotByteLength,
    semanticNodeIds,
    noHorizontalOverflow: observation.noHorizontalOverflow,
    reducedMotion: observation.reducedMotion,
    viewport: observation.viewport,
    exactIdentityMatch
  });
}

if (observations.length !== expectedProjects.length) failures.push(`expected ${expectedProjects.length} browser observations, found ${observations.length}`);
if (new Set(observations.map((entry) => entry.browserProject)).size !== expectedProjects.length) failures.push("browser project evidence is duplicated or incomplete");
const stable = {
  schema: "website-design-compiler/kernel-edited-page-browser-receipt/v1" as const,
  overall: failures.length === 0 ? "PASS" as const : "FAIL" as const,
  subjectHeadSha: proof.subjectHeadSha,
  category: proof.category,
  route: proof.route,
  sourceManifestIdentitySha256: proof.sourceManifestIdentitySha256,
  sourceObservationIdentitySha256: proof.sourceObservationIdentitySha256,
  basePageDigest: proof.basePageDigest,
  patchIdentitySha256: proof.patchIdentitySha256,
  patchReceiptIdentitySha256: proof.patchReceiptIdentitySha256,
  resultPageDigest: proof.resultPageDigest,
  expectedProjects,
  observations,
  failures: [...new Set(failures)].sort()
};
const receipt = { ...stable, receiptIdentitySha256: digest(stable) };
await validateAgainstSchema(receipt, "kernel-edited-page-browser-receipt.schema.json");
await mkdir(uploadedEvidenceRoot, { recursive: true });
const receiptPath = join(uploadedEvidenceRoot, "kernel-edited-page-browser-receipt.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, overall: receipt.overall, subjectHeadSha: receipt.subjectHeadSha, observationCount: observations.length, failureCount: receipt.failures.length }));
if (receipt.overall !== "PASS") process.exitCode = 1;
