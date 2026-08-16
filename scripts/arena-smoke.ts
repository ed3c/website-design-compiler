import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateArena, type ArenaMatrix } from "../src/arena.js";
import type { CompilerInput, EvidenceState, RuntimeReceipt } from "../src/contracts.js";

const root = process.cwd();
const matrixPath = join(root, "fixtures", "arena", "benchmark-matrix.json");
const outputRoot = join(root, "artifacts", "arena");

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function evidenceState(value: unknown): EvidenceState {
  return value === "PASS" || value === "FAIL" || value === "ABSENT" || value === "NOT_IMPLEMENTED" || value === "NOT_EXERCISED" || value === "SKIPPED_BY_POLICY"
    ? value
    : "ABSENT";
}

function passIf(condition: boolean, absent = false): EvidenceState {
  if (absent) return "ABSENT";
  return condition ? "PASS" : "FAIL";
}

await mkdir(outputRoot, { recursive: true });
const matrix = await readJson<ArenaMatrix>(matrixPath);
if (!matrix || matrix.schema !== "website-design-compiler/arena-benchmark-matrix/v1") {
  throw new Error("invalid or missing arena benchmark matrix");
}

const receipts = new Map<string, RuntimeReceipt>();
const benchmarkArtifacts: Array<{ id: string; input: string; runtimeReceipt: string }> = [];

for (const benchmark of matrix.categories) {
  const benchmarkDirectory = join(outputRoot, benchmark.id);
  await mkdir(benchmarkDirectory, { recursive: true });
  const inputPath = join(benchmarkDirectory, "compiler-input.json");
  const compilerOutput = join(benchmarkDirectory, "compiler-output");
  const input: CompilerInput = {
    schema: "website-design-compiler/input/v1",
    project: `arena-${benchmark.id}`,
    brief: {
      pageType: benchmark.pageType,
      audience: benchmark.audience,
      objective: benchmark.objective
    },
    references: [{
      kind: "html",
      value: `<!doctype html><html><head><title>${benchmark.id}</title></head><body><nav><a href='/evidence'>Evidence</a></nav><main><h1>${benchmark.id}</h1><section><h2>Original benchmark fixture</h2></section></main></body></html>`
    }],
    artDirection: {
      primary: ["repo-native"],
      reviewers: ["anthropic-frontend-design"]
    },
    requestedStages: [...matrix.requiredCompilerStages]
  };
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  execFileSync("pnpm", ["exec", "tsx", "src/cli.ts", inputPath, compilerOutput], { cwd: root, stdio: "pipe" });
  const receiptPath = join(compilerOutput, "runtime-receipt.json");
  const runtimeReceipt = await readJson<RuntimeReceipt>(receiptPath);
  if (runtimeReceipt) receipts.set(benchmark.id, runtimeReceipt);
  benchmarkArtifacts.push({
    id: benchmark.id,
    input: `artifacts/arena/${benchmark.id}/compiler-input.json`,
    runtimeReceipt: `artifacts/arena/${benchmark.id}/compiler-output/runtime-receipt.json`
  });
}

type BrowserReceipt = {
  overall?: unknown;
  passedProjects?: string[];
  missingProjects?: string[];
  failedProjects?: string[];
  gates?: Record<string, unknown>;
  artifacts?: { traces?: string[]; screenshots?: string[] };
};
type QualityProject = {
  project?: string;
  overall?: unknown;
  exercisedDegradationPaths?: string[];
  gates?: Record<string, unknown>;
};
type QualityReceipt = {
  overall?: unknown;
  projects?: QualityProject[];
  missingProjects?: string[];
  failedProjects?: string[];
};
type StorybookReceipt = {
  overall?: unknown;
  visualRegression?: unknown;
  gates?: Record<string, unknown>;
};
type ProvenanceReceipt = {
  overall?: unknown;
  reviewQueue?: unknown[];
  denied?: unknown[];
  unknown?: unknown[];
};

const browser = await readJson<BrowserReceipt>(join(root, "artifacts", "browser-qa", "browser-qa.json"));
const quality = await readJson<QualityReceipt>(join(root, "artifacts", "accessibility-performance", "accessibility-performance.json"));
const storybook = await readJson<StorybookReceipt>(join(root, "artifacts", "storybook", "storybook-workshop.json"));
const provenance = await readJson<ProvenanceReceipt>(join(root, "artifacts", "provenance", "license-receipt.json"));
const bindings = await readJson<{
  overall?: unknown;
  sourceRepository?: string;
  sourceIdentity?: string;
  consumerIdentity?: string;
  resolutions?: Array<{ name?: string; state?: string; identity?: string }>;
}>(join(root, "artifacts", "runtime", "shared-binding-receipt.json"));

const projects = new Map((quality?.projects ?? []).map((entry) => [entry.project ?? "", entry]));
const desktop = projects.get("desktop-chromium");
const tablet = projects.get("tablet-chromium");
const mobile = projects.get("mobile-chromium");
const reduced = projects.get("reduced-motion-chromium");
const passedProjects = new Set(browser?.passedProjects ?? []);
const browserMatrix = evidenceState(browser?.overall);
const qualityOverall = evidenceState(quality?.overall);
const provenanceOverall = evidenceState(provenance?.overall);
const bindingOverall = evidenceState(bindings?.overall);

const globalEvidence: Record<string, EvidenceState> = {
  browserMatrix,
  responsiveBehavior: passIf(
    ["desktop-chromium", "tablet-chromium", "mobile-chromium"].every((name) => passedProjects.has(name)) &&
    [desktop, tablet, mobile].every((entry) => evidenceState(entry?.overall) === "PASS"),
    !browser || !quality
  ),
  keyboardCompletion: passIf(
    browserMatrix === "PASS" && [desktop, tablet, mobile, reduced].every((entry) => evidenceState(entry?.overall) === "PASS"),
    !browser || !quality
  ),
  reducedMotion: passIf(
    evidenceState(reduced?.gates?.reducedMotion) === "PASS" && (reduced?.exercisedDegradationPaths ?? []).includes("prefers-reduced-motion"),
    !reduced
  ),
  coarsePointer: passIf(
    evidenceState(mobile?.gates?.coarsePointer) === "PASS" && (mobile?.exercisedDegradationPaths ?? []).includes("coarse-pointer"),
    !mobile
  ),
  graphics2dFallback: passIf(
    evidenceState(desktop?.gates?.graphics2dFallback) === "PASS" && (desktop?.exercisedDegradationPaths ?? []).includes("graphics=off"),
    !desktop
  ),
  graphics3dFallback: passIf(
    evidenceState(desktop?.gates?.graphics3dFallback) === "PASS" && (desktop?.exercisedDegradationPaths ?? []).includes("graphics3d=off"),
    !desktop
  ),
  accessibilityPerformance: qualityOverall,
  visualRegression: passIf(
    evidenceState(storybook?.overall) === "PASS" && storybook?.visualRegression === "PASS" && evidenceState(storybook?.gates?.visualRegression) === "PASS",
    !storybook
  ),
  interactionTraces: passIf(
    browserMatrix === "PASS" && evidenceState(browser?.gates?.traces) === "PASS" && (browser?.artifacts?.traces?.length ?? 0) >= 4,
    !browser
  ),
  buildReliability: passIf(
    evidenceState(storybook?.gates?.storybookBuild) === "PASS" && receipts.size === matrix.categories.length && [...receipts.values()].every((receipt) => receipt.overall === "PASS"),
    !storybook
  ),
  benchmarkProvenanceCompleteness: passIf(
    provenanceOverall === "PASS" && (provenance?.reviewQueue?.length ?? 0) === 0 && (provenance?.denied?.length ?? 0) === 0 && (provenance?.unknown?.length ?? 0) === 0,
    !provenance
  ),
  benchmarkLicenseCompliance: provenanceOverall,
  sharedBindings: bindingOverall
};

const evaluation = evaluateArena(matrix, receipts, globalEvidence);
const metricEvidence = {
  browserMatrix: ["artifacts/browser-qa/browser-qa.json"],
  responsiveBehavior: ["artifacts/browser-qa/browser-qa.json", "artifacts/accessibility-performance/accessibility-performance.json"],
  keyboardCompletion: ["tests/browser/runtime.spec.ts#keyboard-focus-and-primary-action", "artifacts/browser-qa/playwright-report.json"],
  reducedMotion: ["artifacts/accessibility-performance/reduced-motion-chromium.json"],
  coarsePointer: ["artifacts/accessibility-performance/mobile-chromium.json"],
  graphics2dFallback: ["artifacts/accessibility-performance/desktop-chromium.json"],
  graphics3dFallback: ["artifacts/accessibility-performance/desktop-chromium.json"],
  accessibilityPerformance: ["artifacts/accessibility-performance/accessibility-performance.json"],
  visualRegression: ["artifacts/storybook/storybook-workshop.json", "fixtures/storybook/visual-goldens.json"],
  interactionTraces: browser?.artifacts?.traces ?? [],
  buildReliability: ["artifacts/storybook/storybook-workshop.json", ...benchmarkArtifacts.map((entry) => entry.runtimeReceipt)],
  benchmarkProvenanceCompleteness: ["artifacts/provenance/license-receipt.json"],
  benchmarkLicenseCompliance: ["artifacts/provenance/license-receipt.json"],
  sharedBindings: ["artifacts/runtime/shared-binding-receipt.json"]
};

const receipt = {
  ...evaluation,
  git: {
    sha: process.env.GITHUB_SHA ?? "UNBOUND",
    ref: process.env.GITHUB_REF ?? "UNBOUND"
  },
  sharedSkills: bindings ? {
    sourceRepository: bindings.sourceRepository ?? "ABSENT",
    sourceIdentity: bindings.sourceIdentity ?? "ABSENT",
    consumerIdentity: bindings.consumerIdentity ?? "ABSENT",
    resolutions: bindings.resolutions ?? []
  } : "ABSENT",
  benchmarkArtifacts,
  metricEvidence,
  evidence: {
    browser: "artifacts/browser-qa/browser-qa.json",
    accessibilityPerformance: "artifacts/accessibility-performance/accessibility-performance.json",
    storybookVisualGoldens: "artifacts/storybook/storybook-workshop.json",
    licenseProvenance: "artifacts/provenance/license-receipt.json",
    sharedBindings: "artifacts/runtime/shared-binding-receipt.json",
    visualGoldenManifest: "fixtures/storybook/visual-goldens.json"
  },
  scopeNotes: {
    benchmarkProvenanceCompleteness: "PASS applies to the deterministic Arena provenance fixture only; repository-wide rights clearance remains outside this claim.",
    keyboardCompletion: "The browser runtime test contract explicitly exercises Tab focus followed by the primary button action; project PASS plus retained Playwright report/trace is the runtime evidence boundary."
  }
};

const receiptPath = join(outputRoot, "arena-score.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, overall: receipt.overall, benchmarkScore: receipt.benchmarkScore, categoryCoverage: receipt.categoryCoverage }));
if (receipt.overall !== "PASS") process.exitCode = 1;
