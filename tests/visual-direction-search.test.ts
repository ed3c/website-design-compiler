import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CompilerInput } from "../src/contracts.js";
import { buildDesignSystemPlan } from "../src/design-system-compiler.js";
import { validateAgainstSchema } from "../src/validate.js";
import { auditCandidateOriginality, loadVerifiedVisualReferences, searchVisualDirections } from "../src/visual-direction-search.js";

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
  assert.equal(receipt.diversity.state, "PASS");
  assert.ok(receipt.diversity.minimumPairwiseDistance >= receipt.diversity.threshold);
  assert.equal(receipt.originality.state, "NOT_EXERCISED");
  assert.equal(receipt.originality.observedReferenceCount, 0);
});

test("every candidate carries auditable score dimensions and rejection reasons", () => {
  const receipt = searchVisualDirections(input("premium-consumer"));
  for (const candidate of receipt.candidates) {
    assert.ok(candidate.score.briefFit >= 0);
    assert.ok(candidate.score.differentiation >= 0);
    assert.ok(candidate.score.readability >= 0);
    assert.ok(candidate.score.responsiveRobustness >= 0);
    assert.equal(candidate.score.originalityDistance, null);
    assert.equal(Number.isInteger(candidate.score.total), true);
    if (candidate.state === "REJECTED") assert.ok(candidate.rejectionReasons.length > 0);
  }
});

test("originality audit rejects a candidate that is too close to an observed reference", () => {
  const receipt = searchVisualDirections(input("editorial-feature"));
  const candidate = receipt.candidates[0]!;
  const reasons = auditCandidateOriginality(candidate, [candidate.dimensions]);
  assert.ok(reasons.some((reason) => reason.includes("too close to an observed reference")));
});

async function withVisualEvidence<T>(sourceHashOverride: string | null, run: (compilerInput: CompilerInput, root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "wdc-visual-evidence-"));
  try {
    const compilerInput = input("premium-consumer");
    const observed = searchVisualDirections(compilerInput).candidates[0]!.dimensions;
    const value = "<!doctype html><main><h1>Observed reference</h1></main>";
    const evidenceBytes = new TextEncoder().encode("deterministic screenshot bytes");
    await writeFile(join(root, "evidence.png"), evidenceBytes);
    const digest = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");
    const receipt = {
      schema: "website-design-compiler/observed-visual-fingerprint/v2",
      state: "PASS",
      producer: "playwright-computed-style/v1",
      referenceValueSha256: sourceHashOverride ?? digest(value),
      capturedArtifactSha256: digest(value),
      evidenceArtifact: { path: "evidence.png", sha256: digest(evidenceBytes) },
      dimensions: observed,
      observations: ["computed typography", "computed layout", "computed spacing", "computed motion", "observed media"]
    };
    const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
    await writeFile(join(root, "receipt.json"), receiptText, "utf8");
    compilerInput.references = [{
      kind: "html",
      value,
      visualEvidence: { receiptPath: "receipt.json", receiptSha256: digest(receiptText) }
    }];
    return await run(compilerInput, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("runtime-artifact-bound observed fingerprints make originality distance executable", async () => {
  await withVisualEvidence(null, async (compilerInput, root) => {
    const verified = await loadVerifiedVisualReferences(compilerInput, root);
    const receipt = searchVisualDirections(compilerInput, "website-design-compiler/v2", verified);
    const selected = receipt.candidates.find((candidate) => candidate.id === receipt.selectedCandidateId)!;
    assert.equal(receipt.originality.state, "PASS");
    assert.equal(receipt.originality.observedReferenceCount, 1);
    assert.equal(receipt.originality.observations.length, 1);
    assert.ok(receipt.candidates.every((candidate) => candidate.score.originalityDistance !== null));
    assert.ok((selected.score.originalityDistance ?? 0) >= receipt.originality.threshold);
  });
});

test("an observed fingerprint with the wrong source hash fails closed", async () => {
  await assert.rejects(
    withVisualEvidence("0".repeat(64), async (compilerInput, root) => loadVerifiedVisualReferences(compilerInput, root)),
    /not bound to the supplied reference value/
  );
});

test("same input and seed produces identical ranking and winner", () => {
  const first = searchVisualDirections(input("interactive-3d"), "stable-seed");
  const second = searchVisualDirections(input("interactive-3d"), "stable-seed");
  assert.deepEqual(first, second);
});

test("winner becomes the single downstream selected visual direction", () => {
  const compilerInput = input("motion-heavy-creative");
  const search = searchVisualDirections(compilerInput);
  const designSystem = buildDesignSystemPlan(compilerInput, search);
  assert.equal(designSystem.selectedVisualDirection.candidateId, search.selectedCandidateId);
  assert.deepEqual(designSystem.selectedVisualDirection.dimensions, search.selectedDirection);
  assert.equal(designSystem.selectedVisualDirection.source, search.schema);
});

test("design-system schema admits every canonical governed frontend component", async () => {
  const compilerInput = input("b2b-product");
  const designSystem = buildDesignSystemPlan(compilerInput, searchVisualDirections(compilerInput));

  assert.ok(designSystem.governedComponents.includes("rich-section"));
  await validateAgainstSchema(designSystem, "design-system-plan.schema.json");
});

test("design system consumes the supplied search receipt instead of rerunning search", () => {
  const compilerInput = input("product-landing");
  const search = searchVisualDirections(compilerInput, "downstream-selected-seed");
  const designSystem = buildDesignSystemPlan(compilerInput, search);

  assert.equal(designSystem.selectedVisualDirection.searchSeed, "downstream-selected-seed");
  assert.equal(designSystem.selectedVisualDirection.candidateId, search.selectedCandidateId);
  assert.deepEqual(designSystem.selectedVisualDirection.dimensions, search.selectedDirection);
});
