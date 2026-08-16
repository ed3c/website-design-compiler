import test from "node:test";
import assert from "node:assert/strict";
import { buildOriginalityPlan, buildReferenceManifest } from "../src/reference-intelligence.js";
import { observeHtml } from "../src/reference-capture.js";
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
    {
      kind: "html",
      value: "<!doctype html><html><head><title>Evidence Site</title></head><body><nav><a href='/docs'>Docs</a></nav><main><h1>Compiler</h1><section><h2>Evidence first</h2><img src='hero.png' alt='Hero'></section></main></body></html>"
    }
  ],
  requestedStages: ["reference-intelligence", "release-receipt"]
};

test("remote reference remains unexercised while inline html is observed", async () => {
  const manifest = await buildReferenceManifest(input);
  assert.equal(manifest.entries.length, 2);
  assert.equal(manifest.entries[0]?.captureState, "NOT_EXERCISED");
  assert.deepEqual(manifest.entries[0]?.observableFacts, []);
  assert.equal(manifest.entries[1]?.captureState, "PASS");
  assert.equal(manifest.entries[1]?.provenance.sourceMode, "INLINE");
  assert.ok(manifest.entries[1]?.observableFacts.includes("document title: Evidence Site"));
  assert.ok(manifest.entries[1]?.observableFacts.includes("h1 headings: Compiler"));
  assert.ok(manifest.entries[1]?.observableFacts.includes("nav elements: 1"));
  assert.equal(manifest.entries[1]?.unknownImplementationDetails, true);
});

test("html observer only emits supported observable facts", () => {
  const facts = observeHtml("<main><h1>Hello <em>World</em></h1><canvas></canvas><video></video></main>");
  assert.deepEqual(facts, ["h1 headings: Hello World", "main elements: 1", "videos: 1", "canvas elements: 1"]);
});

test("originality policy rejects identity cloning", () => {
  const plan = buildOriginalityPlan();
  assert.equal(plan.policy, "GRAMMAR_ONLY_NO_IDENTITY_CLONING");
  assert.ok(plan.reject.includes("one-to-one page reproduction"));
  assert.ok(plan.reject.includes("invented implementation details"));
});
