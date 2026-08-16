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

const browser = await readJson<{ overall?: unknown }>(join(root, "artifacts", "browser-qa", "browser-qa.json"));
const quality = await readJson<{ overall?: unknown }>(join(root, "artifacts", "accessibility-performance", "accessibility-performance.json"));
const storybook = await readJson<{ overall?: unknown; visualRegression?: unknown }>(join(root, "artifacts", "storybook", "storybook-workshop.json"));
const provenance = await readJson<{ overall?: unknown }>(join(root, "artifacts", "provenance", "license-receipt.json"));
const bindings = await readJson<{
  overall?: unknown;
  sourceRepository?: string;
  sourceIdentity?: string;
  consumerIdentity?: string;
  resolutions?: Array<{ name?: string; state?: string; identity?: string }>;
}>(join(root, "artifacts", "runtime", "shared-binding-receipt.json"));

const storybookVisual = evidenceState(storybook?.overall) === "PASS" && storybook?.visualRegression === "PASS" ? "PASS" : evidenceState(storybook?.overall);
const evaluation = evaluateArena(matrix, receipts, {
  browser: evidenceState(browser?.overall),
  accessibilityPerformance: evidenceState(quality?.overall),
  storybookVisualGoldens: storybookVisual,
  licenseProvenance: evidenceState(provenance?.overall),
  sharedBindings: evidenceState(bindings?.overall)
});

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
  evidence: {
    browser: "artifacts/browser-qa/browser-qa.json",
    accessibilityPerformance: "artifacts/accessibility-performance/accessibility-performance.json",
    storybookVisualGoldens: "artifacts/storybook/storybook-workshop.json",
    licenseProvenance: "artifacts/provenance/license-receipt.json",
    sharedBindings: "artifacts/runtime/shared-binding-receipt.json",
    visualGoldenManifest: "fixtures/storybook/visual-goldens.json"
  }
};

const receiptPath = join(outputRoot, "arena-score.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, overall: receipt.overall, benchmarkScore: receipt.benchmarkScore, categoryCoverage: receipt.categoryCoverage }));
if (receipt.overall !== "PASS") process.exitCode = 1;
