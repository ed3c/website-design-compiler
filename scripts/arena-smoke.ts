import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateArena, type ArenaMatrix } from "../src/arena.js";
import { evaluateArenaV2Metrics } from "../src/arena-v2-metrics.js";
import type { CompilerInput, EvidenceState, RuntimeReceipt } from "../src/contracts.js";
import { compileInformationArchitecture } from "../src/information-architecture.js";
import { OBSERVED_VISUAL_FIXTURE_HTML } from "../src/reference-browser-observation-fixture.js";

const root = process.cwd();
const matrixPath = join(root, "fixtures", "arena", "benchmark-matrix.json");
const outputRoot = join(root, "artifacts", "arena");
const proofSource = "fixtures/content/proof-evidence.txt";
const proofSourceSha256 = createHash("sha256").update(await readFile(join(root, proofSource))).digest("hex");

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

function benchmarkAuthoredContent(slot: string, benchmarkId: string) {
  const source = slot === "proof-items" ? proofSource : `fixture://arena/${benchmarkId}/${slot}`;
  const value = `Benchmark ${slot}`;
  const excerpt = `Synthetic Arena evidence states: ${value}`;
  const needsEvidence = slot === "proof-items";
  return {
    value,
    source: { kind: "benchmark-fixture" as const, uri: source },
    ...(needsEvidence ? {
      evidence: {
        kind: "source-excerpt" as const,
        source,
        sourceSha256: proofSourceSha256,
        excerpt,
        sha256: createHash("sha256").update(`${source}\0${proofSourceSha256}\0${excerpt}\0${value}`).digest("hex")
      }
    } : {})
  };
}

await mkdir(outputRoot, { recursive: true });
const matrix = await readJson<ArenaMatrix>(matrixPath);
if (!matrix || matrix.schema !== "website-design-compiler/arena-benchmark-matrix/v1") {
  throw new Error("invalid or missing arena benchmark matrix");
}

const receipts = new Map<string, RuntimeReceipt>();
const benchmarkArtifacts: Array<{ id: string; input: string; runtimeReceipt: string }> = [];
const diagnostics: string[] = [];
const visualDirectionReceipt = await readJson<{ overall?: unknown }>(join(root, "artifacts", "v2", "visual-direction-search", "receipt.json"));
const visualEvidenceReceiptPath = join(root, "artifacts", "reference-browser", "observed-visual-fingerprint.json");
const visualEvidenceReceiptSha256 = visualDirectionReceipt?.overall === "PASS"
  ? await readFile(visualEvidenceReceiptPath).then((bytes) => createHash("sha256").update(bytes).digest("hex")).catch(() => null)
  : null;

for (const benchmark of matrix.categories) {
  const benchmarkDirectory = join(outputRoot, benchmark.id);
  await mkdir(benchmarkDirectory, { recursive: true });
  const inputPath = join(benchmarkDirectory, "compiler-input.json");
  const compilerOutput = join(benchmarkDirectory, "compiler-output");
  if (visualDirectionReceipt?.overall !== "PASS" || !visualEvidenceReceiptSha256) {
    diagnostics.push(
      visualDirectionReceipt?.overall !== "PASS"
        ? `${benchmark.id}: visual-direction benchmark receipt is ${evidenceState(visualDirectionReceipt?.overall)}`
        : `${benchmark.id}: observed visual fingerprint is absent`
    );
    benchmarkArtifacts.push({
      id: benchmark.id,
      input: `artifacts/arena/${benchmark.id}/compiler-input.json`,
      runtimeReceipt: `artifacts/arena/${benchmark.id}/compiler-output/runtime-receipt.json`
    });
    continue;
  }
  const baseInput: CompilerInput = {
    schema: "website-design-compiler/input/v1",
    project: `arena-${benchmark.id}`,
    brief: {
      pageType: benchmark.pageType,
      audience: benchmark.audience,
      objective: benchmark.objective
    },
    references: [{
      kind: "html",
      value: OBSERVED_VISUAL_FIXTURE_HTML,
      visualEvidence: {
        receiptPath: "artifacts/reference-browser/observed-visual-fingerprint.json",
        receiptSha256: visualEvidenceReceiptSha256
      }
    }],
    artDirection: {
      primary: ["repo-native"],
      reviewers: ["anthropic-frontend-design"]
    },
    requestedStages: [...matrix.requiredCompilerStages]
  };
  const requiredSlots = compileInformationArchitecture(baseInput).sections.flatMap((section) => section.requiredContent);
  const input: CompilerInput = {
    ...baseInput,
    authoredContent: Object.fromEntries(requiredSlots.map((slot) => [slot, benchmarkAuthoredContent(slot, benchmark.id)]))
  };
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  try {
    execFileSync("pnpm", ["exec", "tsx", "src/cli.ts", inputPath, compilerOutput], { cwd: root, stdio: "pipe" });
  } catch {
    diagnostics.push(`${benchmark.id}: compiler execution failed for the current subject`);
    benchmarkArtifacts.push({
      id: benchmark.id,
      input: `artifacts/arena/${benchmark.id}/compiler-input.json`,
      runtimeReceipt: `artifacts/arena/${benchmark.id}/compiler-output/runtime-receipt.json`
    });
    continue;
  }
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
const responsiveV2 = await readJson<{overall?:unknown}>(join(root,"artifacts","v2","responsive-composition","receipt.json"));
const generatedPagesV2 = await readJson<{overall?:unknown;observed?:{screenshots?:number;categories?:number;projects?:number}}>(join(root,"artifacts","generated-pages","generated-page-browser-receipt.json"));
const motionV2 = await readJson<{overall?:unknown}>(join(root,"artifacts","v2","motion-choreography","receipt.json"));
const motionRuntimeV2 = await readJson<{overall?:unknown}>(join(root,"artifacts","motion-choreography","browser-runtime-receipt.json"));
const mediaV2 = await readJson<{overall?:unknown}>(join(root,"artifacts","v2","media-orchestration","receipt.json"));
const mediaRuntimeV2 = await readJson<{overall?:unknown}>(join(root,"artifacts","media-orchestration","browser-runtime-receipt.json"));
const designQualityV2 = await readJson<{overall?:unknown;categoryCount?:number;viewportCoverage?:{mobile?:number;desktop?:number};premium?:{state?:unknown;evaluations?:Array<{card?:{score?:number}}>}}>(join(root,"artifacts","v2","design-quality","design-quality-eval-receipt.json"));

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
const v2Metrics=evaluateArenaV2Metrics({responsive:responsiveV2,generatedPages:generatedPagesV2,motion:motionV2,motionRuntime:motionRuntimeV2,media:mediaV2,mediaRuntime:mediaRuntimeV2,designQuality:designQualityV2});
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
  sharedBindings: ["artifacts/runtime/shared-binding-receipt.json"],
  responsiveCompositionQuality:["artifacts/v2/responsive-composition/receipt.json","artifacts/generated-pages/generated-page-browser-receipt.json"],
  motionChoreographyQuality:["artifacts/v2/motion-choreography/receipt.json","artifacts/motion-choreography/browser-runtime-receipt.json"],
  mediaStrategyFit:["artifacts/v2/media-orchestration/receipt.json","artifacts/media-orchestration/browser-runtime-receipt.json"],
  designQualityPremium:["artifacts/v2/design-quality/design-quality-eval-receipt.json"]
};

const receipt = {
  ...evaluation,
  v2Metrics,
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
    responsiveComposition: "artifacts/v2/responsive-composition/receipt.json",
    generatedPages: "artifacts/generated-pages/generated-page-browser-receipt.json",
    motionChoreography: "artifacts/v2/motion-choreography/receipt.json",
    motionRuntime: "artifacts/motion-choreography/browser-runtime-receipt.json",
    mediaOrchestration: "artifacts/v2/media-orchestration/receipt.json",
    mediaRuntime: "artifacts/media-orchestration/browser-runtime-receipt.json",
    designQuality: "artifacts/v2/design-quality/design-quality-eval-receipt.json",
    visualGoldenManifest: "fixtures/storybook/visual-goldens.json"
  },
  scopeNotes: {
    benchmarkProvenanceCompleteness: "PASS applies to the deterministic Arena provenance fixture only; repository-wide rights clearance remains outside this claim.",
    keyboardCompletion: "The browser runtime test contract explicitly exercises Tab focus followed by the primary button action; project PASS plus retained Playwright report/trace is the runtime evidence boundary.",
    mediaStrategyFit: "The Arena metric requires both the compiler strategy receipt and a separate browser receipt proving lazy activation, bounded Pixi/Three execution, provider fallback and forced media-off behavior."
  },
  diagnostics
};

const receiptPath = join(outputRoot, "arena-score.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, overall: receipt.overall, benchmarkScore: receipt.benchmarkScore, categoryCoverage: receipt.categoryCoverage }));
if (receipt.overall !== "PASS") process.exitCode = 1;
