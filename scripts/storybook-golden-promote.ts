import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAgainstSchema } from "../src/validate.js";
import type { StorybookGoldenCandidate } from "./storybook-golden-candidate.js";

type GoldenReview = {
  schema: "website-design-compiler/storybook-golden-review/v1";
  candidateSha256: string;
  decision: "ADMIT";
  reviewer: { identity: string; context: string; independence: "SEPARATE_REVIEW_CONTEXT" };
  reviewedAt: string;
  inspectedScreenshots: Array<{ name: string; sha256: string; observation: string }>;
};

export type StorybookVisualGoldensV3 = {
  schema: "website-design-compiler/storybook-visual-goldens/v3";
  candidateArtifact: { sha256: string; document: string };
  review: GoldenReview;
};

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertCandidateRuntimeGitBinding(candidate: StorybookGoldenCandidate): void {
  const { git, runtimeGit } = candidate.source;
  if (runtimeGit.ref === git.ref) {
    if (runtimeGit.sha !== git.sha) throw new Error("Storybook candidate and runtime Git on the same ref must bind the same SHA");
    return;
  }
  if (!/^refs\/heads\/.+/.test(git.ref) || !/^refs\/pull\/[1-9][0-9]*\/merge$/.test(runtimeGit.ref)) {
    throw new Error("Storybook candidate Git must bind either its runtime ref or a durable branch head paired with a PR merge runtime ref");
  }
  if (runtimeGit.sha === git.sha) throw new Error("A Storybook PR merge runtime SHA must differ from its durable branch head SHA");
}

function assertPublicReview(review: GoldenReview): void {
  const serialized = JSON.stringify(review);
  const forbidden = [
    /\/(?:Users|home|root|private|tmp|var\/folders)\//i,
    /[A-Za-z]:\\Users\\/i,
    /(?:token|secret|password|cookie|authorization|api[_-]?key)\s*[=:]\s*\S+/i,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/
  ];
  if (forbidden.some((pattern) => pattern.test(serialized))) throw new Error("Storybook golden review contains credentials or machine-private paths");
}

async function writeAtomically(path: string, contents: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, path);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function validateReviewedGoldenManifest(value: unknown, schemaRoot = process.cwd()): Promise<{
  manifest: StorybookVisualGoldensV3;
  candidate: StorybookGoldenCandidate;
  review: GoldenReview;
}> {
  const validated = await validateAgainstSchema<StorybookVisualGoldensV3 | { schema: string }>(value, "storybook-visual-goldens.schema.json", schemaRoot);
  if (validated.schema !== "website-design-compiler/storybook-visual-goldens/v3") {
    throw new Error("Only a reviewed Storybook visual-goldens/v3 manifest can pass admission");
  }
  const manifest = validated as StorybookVisualGoldensV3;
  const candidateBytes = Buffer.from(manifest.candidateArtifact.document, "utf8");
  if (sha256(candidateBytes) !== manifest.candidateArtifact.sha256) throw new Error("Embedded candidate bytes do not match the admitted candidate hash");
  const candidate = await validateAgainstSchema<StorybookGoldenCandidate>(JSON.parse(manifest.candidateArtifact.document) as unknown, "storybook-golden-candidate.schema.json", schemaRoot);
  assertCandidateRuntimeGitBinding(candidate);
  const review = await validateAgainstSchema<GoldenReview>(manifest.review, "storybook-golden-review.schema.json", schemaRoot);
  assertPublicReview(review);
  if (review.candidateSha256 !== manifest.candidateArtifact.sha256) throw new Error("Review is not bound to the embedded candidate bytes");
  const reviewedByName = new Map<string, string>();
  for (const inspected of review.inspectedScreenshots) {
    if (reviewedByName.has(inspected.name)) throw new Error(`Review receipt inspects ${inspected.name} more than once`);
    reviewedByName.set(inspected.name, inspected.sha256);
  }
  if (reviewedByName.size !== Object.keys(candidate.screenshots).length || Object.entries(candidate.screenshots).some(([name, hash]) => reviewedByName.get(name) !== hash)) {
    throw new Error("Review must bind every exact candidate screenshot hash once");
  }
  return { manifest, candidate, review };
}

export async function evaluateReviewedGoldenAdmission(value: unknown, schemaRoot = process.cwd()): Promise<
  | { state: "PASS"; manifest: StorybookVisualGoldensV3; candidate: StorybookGoldenCandidate; review: GoldenReview }
  | { state: "FAIL"; error: string }
> {
  try {
    return { state: "PASS", ...await validateReviewedGoldenManifest(value, schemaRoot) };
  } catch (error) {
    return { state: "FAIL", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function promoteStorybookGoldenCandidate(options: {
  candidatePath: string;
  screenshotsDirectory: string;
  reviewPath: string;
  outputPath: string;
  admit: boolean;
  githubActions: boolean;
  githubRunId?: number;
}): Promise<StorybookVisualGoldensV3> {
  if (!options.admit) throw new Error("Promotion requires the explicit --admit-reviewed-candidate flag");
  if (options.githubActions) throw new Error("Storybook golden promotion cannot run inside GitHub Actions");

  const candidateBytes = await readFile(options.candidatePath);
  const reviewBytes = await readFile(options.reviewPath);
  const candidateValue = JSON.parse(candidateBytes.toString("utf8")) as unknown;
  const reviewValue = JSON.parse(reviewBytes.toString("utf8")) as unknown;
  const candidate = await validateAgainstSchema<StorybookGoldenCandidate>(candidateValue, "storybook-golden-candidate.schema.json", process.cwd());
  assertCandidateRuntimeGitBinding(candidate);
  const review = await validateAgainstSchema<GoldenReview>(reviewValue, "storybook-golden-review.schema.json", process.cwd());
  assertPublicReview(review);
  if (options.githubRunId === candidate.source.workflow.runId) {
    throw new Error("A candidate cannot be promoted by the GitHub workflow run that produced it");
  }
  const candidateSha256 = sha256(candidateBytes);
  if (review.candidateSha256 !== candidateSha256) throw new Error("Review receipt is not bound to the exact candidate bytes");

  const candidateNames = Object.keys(candidate.screenshots).sort();
  const reviewedByName = new Map<string, { sha256: string; observation: string }>();
  for (const inspected of review.inspectedScreenshots) {
    if (reviewedByName.has(inspected.name)) throw new Error(`Review receipt inspects ${inspected.name} more than once`);
    reviewedByName.set(inspected.name, inspected);
  }
  const reviewedNames = [...reviewedByName.keys()].sort();
  if (JSON.stringify(reviewedNames) !== JSON.stringify(candidateNames)) {
    throw new Error("Review receipt must inspect the exact 90 candidate screenshot names");
  }
  for (const name of candidateNames) {
    const expectedSha256 = candidate.screenshots[name];
    const inspected = reviewedByName.get(name);
    if (!expectedSha256 || !inspected || inspected.sha256 !== expectedSha256) {
      throw new Error(`${name} review hash does not match the candidate`);
    }
    const screenshotBytes = await readFile(join(options.screenshotsDirectory, name));
    if (sha256(screenshotBytes) !== expectedSha256) throw new Error(`${name} bytes do not match the candidate hash`);
  }

  const manifest: StorybookVisualGoldensV3 = {
    schema: "website-design-compiler/storybook-visual-goldens/v3",
    candidateArtifact: { sha256: candidateSha256, document: candidateBytes.toString("utf8") },
    review
  };
  await validateReviewedGoldenManifest(manifest);
  await writeAtomically(options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function valueAfter(args: string[], flag: string, fallback: string): string {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
  return resolve(value);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const manifest = await promoteStorybookGoldenCandidate({
    candidatePath: valueAfter(args, "--candidate", join(process.cwd(), "artifacts", "storybook", "golden-candidate.json")),
    screenshotsDirectory: valueAfter(args, "--screenshots", join(process.cwd(), "artifacts", "storybook", "screenshots")),
    reviewPath: valueAfter(args, "--review", join(process.cwd(), "artifacts", "storybook", "golden-review.json")),
    outputPath: valueAfter(args, "--output", join(process.cwd(), "fixtures", "storybook", "visual-goldens.json")),
    admit: args.includes("--admit-reviewed-candidate"),
    githubActions: process.env.GITHUB_ACTIONS === "true",
    ...(process.env.GITHUB_RUN_ID ? { githubRunId: Number(process.env.GITHUB_RUN_ID) } : {})
  });
  console.log(JSON.stringify({
    result: "PROMOTED",
    output: "fixtures/storybook/visual-goldens.json",
    sourceRun: JSON.parse(manifest.candidateArtifact.document).source.workflow.runId,
    screenshotCount: Object.keys(JSON.parse(manifest.candidateArtifact.document).screenshots).length,
    candidateSha256: manifest.candidateArtifact.sha256
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
