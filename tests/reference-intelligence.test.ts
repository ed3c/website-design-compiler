import test from "node:test";
import assert from "node:assert/strict";
import { buildOriginalityPlan, buildReferenceManifest } from "../src/reference-intelligence.js";
import type { CompilerInput } from "../src/contracts.js";

const input: CompilerInput = {
  schema: "website-design-compiler/input/v1",
  project: "reference-fixture",
  brief: {
    pageType: "landing-page",
    audience: "design engineers",
    objective: "demonstrate evidence-first reference handling"
  },
  references: [
    { kind: "url", value: "https://example.com/reference" },
    { kind: "image", value: "fixtures/reference.png" }
  ],
  requestedStages: ["reference-intelligence", "release-receipt"]
};

test("reference inputs normalize without inventing observations", () => {
  const manifest = buildReferenceManifest(input);
  assert.equal(manifest.entries.length, 2);
  assert.equal(manifest.entries[0]?.captureState, "NOT_EXERCISED");
  assert.deepEqual(manifest.entries[0]?.observableFacts, []);
  assert.equal(manifest.entries[0]?.unknownImplementationDetails, true);
});

test("originality policy rejects identity cloning", () => {
  const plan = buildOriginalityPlan();
  assert.equal(plan.policy, "GRAMMAR_ONLY_NO_IDENTITY_CLONING");
  assert.ok(plan.reject.includes("one-to-one page reproduction"));
  assert.ok(plan.reject.includes("invented implementation details"));
});
