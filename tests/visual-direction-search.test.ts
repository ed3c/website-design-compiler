import assert from "node:assert/strict";
import test from "node:test";
import type { CompilerInput } from "../src/contracts.js";
import { buildDesignSystemPlan } from "../src/design-system-compiler.js";
import { auditCandidateOriginality, searchVisualDirections } from "../src/visual-direction-search.js";

function input(pageType = "product-landing"): CompilerInput {
  return {
    schema: "website-design-compiler/input/v1",
    project: `visual-${pageType}`,
    brief: { pageType, audience: "design teams", objective: "communicate a governed product with a clear primary action" },
    requestedStages: ["visual-direction-search", "design-system-compiler"]
  };
}

test("search produces at least three materially different candidate directions and one winner", () => {
  const receipt = searchVisualDirections(input());
  assert.equal(receipt.candidateCount, 3);
  assert.equal(receipt.candidates.filter((candidate) => candidate.state === "SELECTED").length, 1);
  assert.equal(new Set(receipt.candidates.map((candidate) => candidate.signature)).size, 3);
  assert.equal(new Set(receipt.candidates.map((candidate) => candidate.dimensions.grid)).size >= 2, true);
  assert.equal(new Set(receipt.candidates.map((candidate) => candidate.dimensions.typography)).size >= 2, true);
});

test("every candidate carries auditable score dimensions and rejection reasons", () => {
  const receipt = searchVisualDirections(input("premium-consumer"));
  for (const candidate of receipt.candidates) {
    assert.ok(candidate.score.briefFit >= 0);
    assert.ok(candidate.score.differentiation >= 0);
    assert.ok(candidate.score.readability >= 0);
    assert.ok(candidate.score.responsiveRobustness >= 0);
    assert.ok(candidate.score.originalityDistance >= 70);
    assert.equal(Number.isInteger(candidate.score.total), true);
    if (candidate.state === "REJECTED") assert.ok(candidate.rejectionReasons.length > 0);
  }
});

test("originality audit rejects a candidate whose signature matches the reference", () => {
  const receipt = searchVisualDirections(input("editorial-feature"));
  const candidate = receipt.candidates[0]!;
  const reasons = auditCandidateOriginality(candidate, [candidate.signature]);
  assert.ok(reasons.some((reason) => reason.includes("matches a reference")));
});

test("same input and seed produces identical ranking and winner", () => {
  const first = searchVisualDirections(input("interactive-3d"), "stable-seed");
  const second = searchVisualDirections(input("interactive-3d"), "stable-seed");
  assert.deepEqual(first, second);
});

test("winner becomes the single downstream selected visual direction", () => {
  const compilerInput = input("motion-heavy-creative");
  const search = searchVisualDirections(compilerInput);
  const designSystem = buildDesignSystemPlan(compilerInput);
  assert.equal(designSystem.selectedVisualDirection.candidateId, search.selectedCandidateId);
  assert.deepEqual(designSystem.selectedVisualDirection.dimensions, search.selectedDirection);
  assert.equal(designSystem.selectedVisualDirection.source, search.schema);
});
