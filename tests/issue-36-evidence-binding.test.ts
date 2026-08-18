import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIssue36NegativeControls } from "../scripts/issue-36-evidence-binding-receipt.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding } from "../src/design-quality-evidence.js";
import { evaluateDesignQuality } from "../src/design-quality-eval.js";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { validateAgainstSchema } from "../src/validate.js";
import { distantVisualCorpus, qualityObservation, tokenMatchPass } from "./helpers/design-quality.js";

const digest = "a".repeat(64);
const gitSha = "b".repeat(40);
const categories = ["b2b-product", "editorial", "premium-consumer", "motion-heavy", "interactive-2d", "interactive-3d"];

function evaluation(category: string, viewport: "mobile" | "desktop") {
  const graph = compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const card = evaluateDesignQuality(graph, viewport, 50, [], [], .82, qualityObservation(category, viewport), tokenMatchPass, [], distantVisualCorpus(viewport));
  const binding: DesignQualityEvidenceBinding = { schema: "website-design-compiler/design-quality-evidence/v2", category, viewport, pageGraphSha256: digest, designTokensSha256: digest, screenshotSha256: digest, gitSha, graphSignature: card.graphSignature, screenshotPath: `artifacts/design-quality-browser/screenshots/${viewport}--${category}.png` };
  const expected = { category, viewport, pageGraphSha256: digest, designTokensSha256: digest, screenshotSha256: digest, gitSha, graphSignature: card.graphSignature };
  return { card, binding, decision: decidePremiumQuality(card, binding, expected, 50), source: { qualityObservationPath: "../design-quality-browser/fixture.json", qualityObservationSha256: digest, productionProjectionPath: "apps/site/generated/benchmark-page-graphs.json", productionProjectionSha256: digest, semanticTokensSourceSha256: digest } };
}

test("issue 36 negative controls reject every required evidence mutation and the poor fixture", () => {
  const evaluations = categories.flatMap((category) => ([evaluation(category, "mobile"), evaluation(category, "desktop")]));
  const controls = evaluateIssue36NegativeControls(evaluations, 50);
  assert.deepEqual(controls.map(({ id, state }) => ({ id, state })), [
    { id: "mismatched-screenshot-sha", state: "PASS" },
    { id: "wrong-page-graph-sha", state: "PASS" },
    { id: "wrong-design-token-sha", state: "PASS" },
    { id: "wrong-git-sha", state: "PASS" },
    { id: "missing-viewport", state: "PASS" },
    { id: "repetitive-gpu-heavy-fixture", state: "PASS" }
  ]);
});

test("issue 36 binding schema preserves premium FAIL separately from binding PASS", async () => {
  const evidence = { path: "artifacts/example.json", sha256: digest, state: "PASS", sameLineage: "PASS" };
  const entries = categories.flatMap((category) => (["mobile", "desktop"] as const).map((viewport) => ({
    category, viewport, state: "PASS", binding: evaluation(category, viewport).binding,
    checks: { pageGraph: "PASS", designTokens: "PASS", projection: "PASS", observation: "PASS", screenshot: "PASS", git: "PASS", decisionBindings: "PASS" },
    evaluator: { schema: "website-design-compiler/design-quality-eval/v2", releaseProfileSha256: digest, threshold: 78 },
    source: { qualityObservationPath: "../design-quality-browser/fixture.json", qualityObservationSha256: digest, productionProjectionPath: "apps/site/generated/benchmark-page-graphs.json", productionProjectionSha256: digest, semanticTokensSourceSha256: digest, browserReceiptSha256: digest },
    score: { value: 76, overall: "FAIL", dimensions: { hierarchy: 90, composition: 80, rhythm: 80, density: 80, ctaClarity: 80, responsiveCoherence: 80, mediaRestraint: 80, motionRestraint: 80, differentiation: 40, originality: 10 }, reasons: ["originality"] }
  })));
  const receipt = {
    schema: "website-design-compiler/issue-36-evidence-binding/v1", overall: "PASS",
    git: { ref: "refs/heads/test", sha: gitSha, tree: "c".repeat(40) }, predecessor: evidence,
    evaluator: { ...evidence, path: "artifacts/v2/design-quality/design-quality-eval-receipt.json", schema: "website-design-compiler/design-quality-eval-receipt/v2", result: "FAIL", releaseProfile: { schema: "profile/v2", id: "premium", sha256: digest, premiumQualityThreshold: 78, originalitySimilarityThreshold: .82 } },
    browser: { runtime: evidence, generatedPages: evidence }, inventory: { state: "PASS", expected: 12, observed: 12, categories, viewports: ["mobile", "desktop"], entries },
    negativeControls: { state: "PASS", cases: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, expected: "FAIL", observed: "FAIL", state: "PASS" })) },
    residual: { premiumEvaluation: "FAIL", reason: "Binding PASS does not promote premium quality." }, failures: []
  };
  await validateAgainstSchema(receipt, "issue-36-evidence-binding.schema.json");
  const malformed = structuredClone(receipt) as Record<string, any>;
  malformed.inventory.entries[0].checks.screenshot = "ABSENT";
  await assert.rejects(validateAgainstSchema(malformed, "issue-36-evidence-binding.schema.json"), /screenshot/);
});
