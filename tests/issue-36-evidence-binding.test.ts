import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIssue36NegativeControls } from "../scripts/issue-36-evidence-binding-receipt.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding } from "../src/design-quality-evidence.js";
import { evaluateDesignQualityV3 } from "../src/design-quality-eval.js";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { validateAgainstSchema } from "../src/validate.js";
import { distantVisualCorpus, qualityObservation, tokenMatchPass } from "./helpers/design-quality.js";

const digest = "a".repeat(64);
const gitSha = "b".repeat(40);
const categories = ["b2b-product", "editorial", "premium-consumer", "motion-heavy", "interactive-2d", "interactive-3d"];

function evaluation(category: string, viewport: "mobile" | "desktop") {
  const pages=compileAllSectionPageFixtures();
  const graph = compileCompletePageGraph(pages.find((page)=>page.category===category)!);
  const graphs=pages.map(compileCompletePageGraph);
  const card = evaluateDesignQualityV3(graph, viewport, { observation:qualityObservation(category, viewport),tokenMatch:tokenMatchPass,structuralCorpus:graphs.filter((candidate)=>candidate.category!==category).map((candidate)=>({id:candidate.category,graph:candidate})),visualCorpus:distantVisualCorpus(viewport) });
  const binding: DesignQualityEvidenceBinding = { schema: "website-design-compiler/design-quality-evidence/v2", category, viewport, pageGraphSha256: digest, designTokensSha256: digest, screenshotSha256: digest, gitSha, graphSignature: card.graphSignature, screenshotPath: `artifacts/design-quality-browser/screenshots/${viewport}--${category}.png` };
  const expected = { category, viewport, pageGraphSha256: digest, designTokensSha256: digest, screenshotSha256: digest, gitSha, graphSignature: card.graphSignature };
  return { card, binding, decision: decidePremiumQuality(card, binding, expected, 78), source: { generatedPageReceipt:"website-design-compiler/generated-page-browser-receipt/v3",generatedPageReceiptGitSha:gitSha,qualityObservationPath: "../design-quality-browser/fixture.json", qualityObservationSha256: digest, productionProjection:"website-design-compiler/site-page-graph-projection/v2",productionProjectionPath: "apps/site/generated/benchmark-page-graphs.json", productionProjectionSha256: digest, semanticTokensSourceSha256: digest,structuralOriginalityCorpus:categories.filter((entry)=>entry!==category),visualOriginalityCorpus:categories.filter((entry)=>entry!==category) } };
}

test("issue 36 negative controls reject every required evidence mutation and the poor fixture", () => {
  const evaluations = categories.flatMap((category) => ([evaluation(category, "mobile"), evaluation(category, "desktop")]));
  const controls = evaluateIssue36NegativeControls(evaluations, 78);
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
    evaluator: { schema: "website-design-compiler/design-quality-eval/v3", releaseProfileSha256: digest, threshold: 78 },
    source: { generatedPageReceipt:"website-design-compiler/generated-page-browser-receipt/v3",generatedPageReceiptGitSha:gitSha,qualityObservationPath: "../design-quality-browser/fixture.json", qualityObservationSha256: digest, productionProjection:"website-design-compiler/site-page-graph-projection/v2",productionProjectionPath: "apps/site/generated/benchmark-page-graphs.json", productionProjectionSha256: digest, semanticTokensSourceSha256: digest,structuralOriginalityCorpus:categories.filter((entry)=>entry!==category),visualOriginalityCorpus:categories.filter((entry)=>entry!==category),browserReceiptSha256: digest },
    score: { value: 76, overall: "FAIL", dimensions: { hierarchy: 90, composition: 80, rhythm: 80, density: 80, ctaClarity: 80, responsiveCoherence: 80, mediaRestraint: 80, motionRestraint: 80, differentiation: 40, originality: 10 }, reasons: ["originality"] }
  })));
  const receipt = {
    schema: "website-design-compiler/issue-36-evidence-binding/v2", overall: "PASS",
    git: { ref: "refs/heads/test", sha: gitSha, tree: "c".repeat(40) }, predecessor: evidence,
    evaluator: { ...evidence, path: "artifacts/v3/design-quality/design-quality-eval-receipt.json", schema: "website-design-compiler/design-quality-eval-receipt/v3", result: "FAIL", releaseProfile: { schema: "website-design-compiler/design-quality-release-profile/v3", id: "premium-web-v3", sha256: digest, premiumQualityThreshold: 78, originalitySimilarityThreshold: .82,requiredViewports:["mobile","desktop"],requireExactEvidenceBinding:true,evaluator:{schema:"website-design-compiler/design-quality-evaluator-config/v3",scoreModel:"runtime-evidence-weighted/v3",structuralSimilarity:"ordered-page-graph/v1",visualSimilarity:"calibrated-visual/v1"},calibrationReceipt:{path:"artifacts/v3/design-quality-calibration/design-quality-calibration-receipt.json",schema:"website-design-compiler/design-quality-calibration-receipt/v2"} } },
    browser: { runtime: evidence, generatedPages: evidence }, inventory: { state: "PASS", expected: 12, observed: 12, categories, viewports: ["mobile", "desktop"], entries },
    negativeControls: { state: "PASS", cases: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, expected: "FAIL", observed: "FAIL", state: "PASS" })) },
    residual: { premiumEvaluation: "FAIL", reason: "Binding PASS does not promote premium quality." }, failures: []
  };
  await validateAgainstSchema(receipt, "issue-36-evidence-binding.schema.json");
  const malformed = structuredClone(receipt) as Record<string, any>;
  malformed.inventory.entries[0].checks.screenshot = "ABSENT";
  await assert.rejects(validateAgainstSchema(malformed, "issue-36-evidence-binding.schema.json"), /screenshot/);
  const lowered = structuredClone(receipt) as Record<string, any>;
  lowered.evaluator.releaseProfile.premiumQualityThreshold=77;
  await assert.rejects(validateAgainstSchema(lowered,"issue-36-evidence-binding.schema.json"),/must be >= 78/);
});
