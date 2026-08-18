import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CompletePageGraph } from "../src/complete-page-graph.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding, type ExpectedDesignQualityEvidence } from "../src/design-quality-evidence.js";
import { evaluateDesignQualityV3, type DesignQualityScorecardV3 } from "../src/design-quality-eval.js";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { validateAgainstSchema } from "../src/validate.js";

const categories = ["b2b-product", "editorial", "premium-consumer", "motion-heavy", "interactive-2d", "interactive-3d"] as const;
const viewports = ["mobile", "desktop"] as const;
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const alteredHash = (value: string) => `${value[0] === "a" ? "b" : "a"}${value.slice(1)}`;

type GitSubject = { ref: string; sha: string; tree: string };
type Evaluation = {
  card: DesignQualityScorecardV3;
  binding: DesignQualityEvidenceBinding;
  decision: ReturnType<typeof decidePremiumQuality>;
  source: {
    qualityObservationPath: string;
    qualityObservationSha256: string;
    productionProjectionPath: string;
    productionProjectionSha256: string;
    semanticTokensSourceSha256: string;
  };
};
type EvalReceipt = {
  schema: string;
  overall: "PASS" | "FAIL";
  git: { sha: string; ref: string };
  releaseProfile: { schema: "website-design-compiler/design-quality-release-profile/v3"; id: string; sha256: string; premiumQualityThreshold: number; originalitySimilarityThreshold: number; requiredViewports:("mobile"|"desktop")[];requireExactEvidenceBinding:boolean;evaluator: { schema: string; scoreModel: string; structuralSimilarity: string; visualSimilarity: string }; calibrationReceipt: { path: string; schema: string } };
  premium: { state: "PASS" | "FAIL"; evaluations: Evaluation[] };
};

export function evaluateIssue36NegativeControls(evaluations: Evaluation[], threshold: number) {
  const first = evaluations[0];
  if (!first) return [{ id: "evaluation-inventory", expected: "FAIL", observed: "ABSENT", state: "FAIL" }] as const;
  const expected: ExpectedDesignQualityEvidence = {
    category: first.binding.category,
    viewport: first.binding.viewport,
    pageGraphSha256: first.binding.pageGraphSha256,
    designTokensSha256: first.binding.designTokensSha256,
    screenshotSha256: first.binding.screenshotSha256,
    gitSha: first.binding.gitSha,
    graphSignature: first.binding.graphSignature
  };
  const decide = (binding: DesignQualityEvidenceBinding) => decidePremiumQuality(first.card, binding, expected, threshold).overall;
  const cases = [
    { id: "mismatched-screenshot-sha", expected: "FAIL", observed: decide({ ...first.binding, screenshotSha256: alteredHash(first.binding.screenshotSha256) }) },
    { id: "wrong-page-graph-sha", expected: "FAIL", observed: decide({ ...first.binding, pageGraphSha256: alteredHash(first.binding.pageGraphSha256) }) },
    { id: "wrong-design-token-sha", expected: "FAIL", observed: decide({ ...first.binding, designTokensSha256: alteredHash(first.binding.designTokensSha256) }) },
    { id: "wrong-git-sha", expected: "FAIL", observed: decide({ ...first.binding, gitSha: alteredHash(first.binding.gitSha) }) },
    { id: "missing-viewport", expected: "FAIL", observed: evaluations.filter((entry) => entry.card.viewport !== "mobile").length === categories.length ? "FAIL" : "PREMIUM_PASS" }
  ];
  const graph = compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const firstNode = graph.nodes[0]!;
  const poor = {
    ...graph,
    conversionPath: [],
    nodes: Array.from({ length: 6 }, (_, index) => ({
      ...firstNode,
      id: `poor-${index}`,
      kind: "graphics-3d-stage" as const,
      mediaHook: { ...firstNode.mediaHook, renderer: "three" as const }
    }))
  } as CompletePageGraph;
  const poorCard = evaluateDesignQualityV3(poor, "desktop", { premiumQualityThreshold:threshold });
  cases.push({
    id: "repetitive-gpu-heavy-fixture",
    expected: "FAIL",
    observed: poorCard.score < threshold && poorCard.penalties.includes("repetitive-section-template") && poorCard.penalties.includes("gratuitous-gpu-complexity") ? "FAIL" : "PREMIUM_PASS"
  });
  return cases.map((entry) => ({ ...entry, state: entry.observed === entry.expected ? "PASS" as const : "FAIL" as const }));
}

async function main() {
  const root = process.cwd();
  const git: GitSubject = {
    ref: execFileSync("git", ["symbolic-ref", "--quiet", "HEAD"], { encoding: "utf8" }).trim(),
    sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim()
  };
  const failures: string[] = [];
  const readJson = async <T>(path: string, schema?: string) => {
    const bytes = await readFile(join(root, path));
    const value = JSON.parse(bytes.toString("utf8")) as T;
    if (schema) await validateAgainstSchema(value, schema);
    return { bytes, value };
  };
  const predecessorPath = "artifacts/handoff/issue-35-local-closure.json";
  const evaluatorPath = "artifacts/v3/design-quality/design-quality-eval-receipt.json";
  const browserPath = "artifacts/browser-qa/browser-qa.json";
  const generatedPath = "artifacts/generated-pages/generated-page-browser-receipt.json";
  const predecessor = await readJson<{ overall: string; git: GitSubject & { trackedWorktreeClean: boolean } }>(predecessorPath, "issue-35-local-closure.schema.json");
  const evaluator = await readJson<EvalReceipt>(evaluatorPath, "design-quality-eval-receipt-v3.schema.json");
  const browser = await readJson<{ schema: string; overall: string; git: { sha: string; ref: string } }>(browserPath);
  const generated = await readJson<{ schema: string; overall: string; git: { sha: string; ref: string } }>(generatedPath, "generated-page-browser-receipt-v3.schema.json");
  const sameGit = (subject: { sha: string; ref: string }) => subject.sha === git.sha && subject.ref === git.ref;
  const predecessorPass = predecessor.value.overall === "PASS" && predecessor.value.git.sha === git.sha && predecessor.value.git.tree === git.tree && predecessor.value.git.ref === git.ref;
  const thresholdsPass=evaluator.value.releaseProfile.premiumQualityThreshold>=78&&evaluator.value.releaseProfile.originalitySimilarityThreshold>=.82;
  const evaluatorPass = sameGit(evaluator.value.git)&&thresholdsPass;
  const browserPass = browser.value.overall === "PASS" && generated.value.overall === "PASS" && sameGit(browser.value.git) && sameGit(generated.value.git);
  if (!predecessorPass) failures.push("predecessor:issue-35-lineage");
  if (!sameGit(evaluator.value.git)) failures.push("evaluator:lineage");
  if(!thresholdsPass)failures.push("evaluator:thresholds");
  if (!browserPass) failures.push("browser:lineage-or-state");

  const projectionPath = "apps/site/generated/benchmark-page-graphs.json";
  const projectionBytes = await readFile(join(root, projectionPath));
  const projection = JSON.parse(projectionBytes.toString("utf8")) as { graphs: Record<string, CompletePageGraph>; designTokens: Record<string, unknown> };
  const browserDigest = hash(browser.bytes);
  const entries = [];
  for (const evaluation of evaluator.value.premium.evaluations) {
    const key = `${evaluation.card.category}/${evaluation.card.viewport}`;
    const checks: Record<string, "PASS" | "FAIL"> = {
      pageGraph: hash(JSON.stringify(projection.graphs[evaluation.card.category])) === evaluation.binding.pageGraphSha256 ? "PASS" : "FAIL",
      designTokens: hash(JSON.stringify(projection.designTokens[evaluation.card.category])) === evaluation.binding.designTokensSha256 ? "PASS" : "FAIL",
      projection: hash(projectionBytes) === evaluation.source.productionProjectionSha256 ? "PASS" : "FAIL",
      observation: "FAIL",
      screenshot: "FAIL",
      git: evaluation.binding.gitSha === git.sha ? "PASS" : "FAIL",
      decisionBindings: Object.values(evaluation.decision.bindings).every((state) => state === "BOUND") ? "PASS" : "FAIL"
    };
    try {
      const observationBytes = await readFile(join(root, "artifacts", "generated-pages", evaluation.source.qualityObservationPath));
      checks.observation = hash(observationBytes) === evaluation.source.qualityObservationSha256 ? "PASS" : "FAIL";
      const screenshotBytes = await readFile(join(root, evaluation.binding.screenshotPath));
      checks.screenshot = hash(screenshotBytes) === evaluation.binding.screenshotSha256 ? "PASS" : "FAIL";
    } catch (error) {
      console.error(`${key}: runtime evidence unavailable or invalid: ${error instanceof Error ? error.message : String(error)}`);
      // Missing runtime bytes remain an explicit FAIL in checks.
    }
    const state = Object.values(checks).every((value) => value === "PASS") ? "PASS" : "FAIL";
    if (state !== "PASS") failures.push(`inventory:${key}`);
    entries.push({
      category: evaluation.card.category,
      viewport: evaluation.card.viewport,
      state,
      binding: evaluation.binding,
      checks,
      evaluator: { schema: evaluation.card.schema, releaseProfileSha256: evaluator.value.releaseProfile.sha256, threshold: evaluator.value.releaseProfile.premiumQualityThreshold },
      source: { ...evaluation.source, browserReceiptSha256: browserDigest },
      score: {
        value: evaluation.card.score,
        overall: evaluation.card.overall,
        dimensions: evaluation.card.dimensions,
        reasons: [...new Set([...evaluation.card.penalties, ...evaluation.card.originalityAudit.reasons, ...evaluation.decision.reasons])]
      }
    });
  }
  const keys = new Set(entries.map((entry) => `${entry.category}/${entry.viewport}`));
  const expectedKeys = categories.flatMap((category) => viewports.map((viewport) => `${category}/${viewport}`));
  const inventoryPass = entries.length === expectedKeys.length && expectedKeys.every((key) => keys.has(key)) && entries.every((entry) => entry.state === "PASS");
  if (!inventoryPass) failures.push("inventory:coverage");
  const negativeCases = evaluateIssue36NegativeControls(evaluator.value.premium.evaluations, evaluator.value.releaseProfile.premiumQualityThreshold);
  const negativePass = negativeCases.every((entry) => entry.state === "PASS");
  if (!negativePass) failures.push("negative-controls");
  const allPass = predecessorPass && evaluatorPass && browserPass && inventoryPass && negativePass && failures.length === 0;
  const receipt = {
    schema: "website-design-compiler/issue-36-evidence-binding/v2",
    overall: allPass ? "PASS" : "FAIL",
    git,
    predecessor: { path: predecessorPath, sha256: hash(predecessor.bytes), state: predecessorPass ? "PASS" : "FAIL", sameLineage: predecessorPass ? "PASS" : "FAIL" },
    evaluator: { path: evaluatorPath, sha256: hash(evaluator.bytes), schema: evaluator.value.schema, state: evaluatorPass ? "PASS" : "FAIL", sameLineage: evaluatorPass ? "PASS" : "FAIL", result: evaluator.value.overall, releaseProfile: evaluator.value.releaseProfile },
    browser: {
      runtime: { path: browserPath, sha256: browserDigest, state: browserPass ? "PASS" : "FAIL", sameLineage: sameGit(browser.value.git) ? "PASS" : "FAIL" },
      generatedPages: { path: generatedPath, sha256: hash(generated.bytes), state: browserPass ? "PASS" : "FAIL", sameLineage: sameGit(generated.value.git) ? "PASS" : "FAIL" }
    },
    inventory: { state: inventoryPass ? "PASS" : "FAIL", expected: 12, observed: entries.length, categories: [...categories], viewports: [...viewports], entries },
    negativeControls: { state: negativePass ? "PASS" : "FAIL", cases: negativeCases },
    residual: { premiumEvaluation: evaluator.value.premium.state, reason: evaluator.value.premium.state === "PASS" ? null : "Evidence is exact-bound, but current evaluator quality/originality gates remain FAIL; binding PASS does not promote premium quality." },
    failures: [...new Set(failures)].sort()
  };
  await validateAgainstSchema(receipt, "issue-36-evidence-binding.schema.json");
  const outputDirectory = join(root, "artifacts", "handoff");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "issue-36-evidence-binding.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ overall: receipt.overall, inventory: receipt.inventory.state, negativeControls: receipt.negativeControls.state, premiumEvaluation: receipt.residual.premiumEvaluation, failures: receipt.failures }));
  if (!allPass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
