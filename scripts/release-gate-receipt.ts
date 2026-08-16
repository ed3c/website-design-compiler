import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateReleaseGate, type ReleaseInputState } from "../src/release-gate.js";

const root = process.cwd();

async function readOverall(path: string): Promise<ReleaseInputState> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { overall?: unknown };
    const state = value.overall;
    if (state === "PASS" || state === "FAIL" || state === "NOT_IMPLEMENTED" || state === "NOT_EXERCISED" || state === "ABSENT" || state === "SKIPPED_BY_POLICY") {
      return state;
    }
    return "FAIL";
  } catch {
    return "ABSENT";
  }
}

const runtimePath = join(root, "artifacts", "runtime", "minimal", "runtime-receipt.json");
const browserPath = join(root, "artifacts", "browser-qa", "browser-qa.json");
const qualityPath = join(root, "artifacts", "accessibility-performance", "accessibility-performance.json");
const storybookPath = join(root, "artifacts", "storybook", "storybook-workshop.json");
const outputDirectory = join(root, "artifacts", "release");
const outputPath = join(outputDirectory, "release-gate-receipt.json");

const evaluation = evaluateReleaseGate({
  runtime: await readOverall(runtimePath),
  browser: await readOverall(browserPath),
  accessibilityPerformance: await readOverall(qualityPath),
  storybook: await readOverall(storybookPath)
});

const receipt = {
  schema: "website-design-compiler/release-gate-receipt/v1",
  overall: evaluation.overall,
  git: {
    sha: process.env.GITHUB_SHA ?? "UNBOUND",
    ref: process.env.GITHUB_REF ?? "UNBOUND"
  },
  gates: evaluation.gates,
  evidence: {
    runtime: "artifacts/runtime/minimal/runtime-receipt.json",
    browser: "artifacts/browser-qa/browser-qa.json",
    accessibilityPerformance: "artifacts/accessibility-performance/accessibility-performance.json",
    storybook: "artifacts/storybook/storybook-workshop.json"
  }
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath: outputPath, overall: receipt.overall, gates: receipt.gates }));
if (receipt.overall !== "PASS") process.exitCode = 1;
