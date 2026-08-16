import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { evaluateReleaseGate, type ReleaseInputState } from "../src/release-gate.js";

const root = process.cwd();

async function readOverall(path: string): Promise<ReleaseInputState> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { overall?: unknown };
    const state = value.overall;
    if (state === "PASS" || state === "FAIL" || state === "NOT_IMPLEMENTED" || state === "NOT_EXERCISED" || state === "ABSENT" || state === "SKIPPED_BY_POLICY") return state;
    return "FAIL";
  } catch {
    return "ABSENT";
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return null; }
}

function commandVersion(command: string, args: string[]): string {
  try { return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim(); } catch { return "NOT_EXERCISED"; }
}

function changedFiles(): string[] {
  try {
    return execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", process.env.GITHUB_SHA ?? "HEAD"], { cwd: root, encoding: "utf8" })
      .split("\n").map((value) => value.trim()).filter(Boolean).sort();
  } catch { return []; }
}

const runtimePath = join(root, "artifacts", "runtime", "minimal", "runtime-receipt.json");
const browserPath = join(root, "artifacts", "browser-qa", "browser-qa.json");
const qualityPath = join(root, "artifacts", "accessibility-performance", "accessibility-performance.json");
const storybookPath = join(root, "artifacts", "storybook", "storybook-workshop.json");
const sharedBindingPath = join(root, "artifacts", "runtime", "shared-binding-receipt.json");
const arenaPath = join(root, "artifacts", "arena", "arena-score.json");
const showcasePath = join(root, "artifacts", "showcase", "showcase-compiler-receipt.json");
const externalSkillsPath = join(root, "artifacts", "external-skills", "registry-receipt.json");
const mediaGeneratorPath = join(root, "artifacts", "media-generator", "media-generation-receipt.json");
const authoringStudioPath = join(root, "artifacts", "authoring", "authoring-receipt.json");
const payloadCmsPath = join(root, "artifacts", "cms", "payload-cms-receipt.json");
const projectPath = join(root, "project.json");
const outputDirectory = join(root, "artifacts", "release");
const outputPath = join(outputDirectory, "release-gate-receipt.json");

const sharedBinding = await readJson<{ sourceRepository?: string; sourceIdentity?: string; consumerIdentity?: string; resolutions?: Array<{ name?: string; state?: string; identity?: string }> }>(sharedBindingPath);
const project = await readJson<{ referenceIntelligence?: Record<string, unknown>; graphics3d?: Record<string, unknown>; licenseProvenance?: Record<string, unknown> }>(projectPath);

const evaluation = evaluateReleaseGate({
  runtime: await readOverall(runtimePath),
  browser: await readOverall(browserPath),
  accessibilityPerformance: await readOverall(qualityPath),
  storybook: await readOverall(storybookPath),
  sharedBindings: await readOverall(sharedBindingPath),
  arena: await readOverall(arenaPath),
  showcase: await readOverall(showcasePath),
  externalSkills: await readOverall(externalSkillsPath),
  mediaGenerator: await readOverall(mediaGeneratorPath),
  authoringStudio: await readOverall(authoringStudioPath),
  payloadCms: await readOverall(payloadCmsPath)
});

const unresolvedRisks = [
  { id: "reference-live-remote-capture", state: project?.referenceIntelligence?.liveThirdPartyRemoteCapture ?? "NOT_EXERCISED", reason: "live third-party URL availability remains opt-in; deterministic SSRF-safe adapter tests are separate from external-site uptime" },
  { id: "webgpu-tsl", state: project?.graphics3d?.webgpuTsl ?? "ABSENT", reason: "WebGPU/TSL remains an optional unexercised graphics path" },
  { id: "repository-wide-rights-clearance", state: project?.licenseProvenance?.repositoryWideRightsClearance ?? "ABSENT", reason: project?.licenseProvenance?.repositoryWideRightsClearanceReason ?? "repository-wide rights clearance is not established" },
  { id: "production-generative-model-rights", state: "NOT_EXERCISED", reason: "only the deterministic internal mock model is admitted; real image/video/3D model weights and output terms remain review-required until exact rights evidence passes license-provenance" }
].filter((risk) => risk.state !== "PASS");

const commands = [
  "pnpm install --no-frozen-lockfile", "pnpm typecheck", "pnpm build", "pnpm test", "pnpm provenance:fixture", "pnpm compile:fixture",
  "pnpm showcase:compile", "pnpm showcase:compiler-receipt", "pnpm external-skills:receipt", "pnpm media:fixture", "pnpm authoring:receipt", "pnpm cms:fixture", "pnpm ui:typecheck", "pnpm ui:build", "pnpm browser:typecheck", "pnpm storybook:typecheck", "pnpm arena:typecheck",
  "pnpm exec playwright install --with-deps chromium", "pnpm reference:media-fixture", "pnpm reference:browser-fixture",
  "pnpm verify:bindings fixtures/bindings/registry-projection.json skills artifacts/runtime/shared-binding-receipt.json",
  "pnpm storybook:build", "pnpm storybook:qa", "pnpm storybook:receipt", "pnpm browser:qa", "pnpm browser:receipt", "pnpm quality:receipt", "pnpm arena:smoke", "pnpm release:receipt"
];

const receipt = {
  schema: "website-design-compiler/release-gate-receipt/v2",
  overall: evaluation.overall,
  git: { sha: process.env.GITHUB_SHA ?? "UNBOUND", ref: process.env.GITHUB_REF ?? "UNBOUND", event: process.env.GITHUB_EVENT_NAME ?? "UNBOUND", changedFiles: changedFiles() },
  workflow: { name: process.env.GITHUB_WORKFLOW ?? "UNBOUND", runId: process.env.GITHUB_RUN_ID ?? "UNBOUND", runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "UNBOUND", job: process.env.GITHUB_JOB ?? "UNBOUND", commands },
  environment: {
    node: process.version, pnpm: commandVersion("pnpm", ["--version"]), playwright: commandVersion("pnpm", ["exec", "playwright", "--version"]),
    platform: platform(), osRelease: release(), arch: arch(), runnerOs: process.env.RUNNER_OS ?? "UNBOUND", runnerArch: process.env.RUNNER_ARCH ?? "UNBOUND", imageOs: process.env.ImageOS ?? "UNBOUND", imageVersion: process.env.ImageVersion ?? "UNBOUND"
  },
  bindings: sharedBinding ? { sourceRepository: sharedBinding.sourceRepository ?? "ABSENT", sourceIdentity: sharedBinding.sourceIdentity ?? "ABSENT", consumerIdentity: sharedBinding.consumerIdentity ?? "ABSENT", resolutions: sharedBinding.resolutions ?? [] } : "ABSENT",
  gates: evaluation.gates,
  evidence: {
    runtime: "artifacts/runtime/minimal/runtime-receipt.json",
    browser: "artifacts/browser-qa/browser-qa.json",
    accessibilityPerformance: "artifacts/accessibility-performance/accessibility-performance.json",
    storybook: "artifacts/storybook/storybook-workshop.json",
    sharedBindings: "artifacts/runtime/shared-binding-receipt.json",
    arena: "artifacts/arena/arena-score.json",
    showcase: "artifacts/showcase/showcase-compiler-receipt.json",
    externalSkills: "artifacts/external-skills/registry-receipt.json",
    mediaGenerator: "artifacts/media-generator/media-generation-receipt.json",
    authoringStudio: "artifacts/authoring/authoring-receipt.json",
    payloadCms: "artifacts/cms/payload-cms-receipt.json"
  },
  unresolvedRisks
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath: outputPath, overall: receipt.overall, gates: receipt.gates, unresolvedRiskCount: unresolvedRisks.length }));
if (receipt.overall !== "PASS") process.exitCode = 1;
