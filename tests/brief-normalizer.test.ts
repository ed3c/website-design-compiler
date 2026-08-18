import assert from "node:assert/strict";
import test from "node:test";
import { BRIEF_NORMALIZER_CONFIG, BRIEF_NORMALIZER_VERSION, normalizeBrief } from "../src/brief-normalizer.js";

test("explicit natural-language brief normalizes into a compiler-ready contract", () => {
  const receipt = normalizeBrief({
    schema: "website-design-compiler/brief-input/v2",
    project: "brief-ready",
    briefText: [
      "Page type: b2b product landing",
      "Audience: design engineering teams",
      "Objective: explain the product and drive inspection of the compiler contract",
      "Must preserve semantic HTML.",
      "Do not invent testimonials, metrics, customer logos, or pricing."
    ].join("\n")
  });

  assert.equal(receipt.state, "READY");
  assert.equal(receipt.fields.pageType.state, "EXPLICIT");
  assert.equal(receipt.fields.audience.value, "design engineering teams");
  assert.equal(receipt.compilerInput?.schema, "website-design-compiler/input/v1");
  assert.ok(receipt.compilerInput?.requestedStages.includes("information-architecture"));
  assert.deepEqual(receipt.riskyContentRequests, []);
  assert.ok(receipt.hardConstraints.some((constraint) => constraint.startsWith("Do not invent")));
  assert.deepEqual(receipt.compilerInput?.hardConstraints, receipt.hardConstraints);
  assert.equal(receipt.normalizer.version, BRIEF_NORMALIZER_VERSION);
  assert.equal(receipt.normalizer.config, BRIEF_NORMALIZER_CONFIG);
  assert.match(receipt.inputSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.structuredContractSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.validationErrors, []);
});

test("missing required brief facts fail closed as NEEDS_INPUT", () => {
  const receipt = normalizeBrief({
    schema: "website-design-compiler/brief-input/v2",
    project: "brief-incomplete",
    briefText: "Build a polished website."
  });

  assert.equal(receipt.state, "NEEDS_INPUT");
  assert.equal(receipt.compilerInput, null);
  assert.equal(receipt.structuredContractSha256, null);
  assert.ok(receipt.needsInput.includes("audience"));
  assert.ok(receipt.needsInput.includes("objective"));
});

test("requested risky content requires evidence instead of fabricated claims", () => {
  const receipt = normalizeBrief({
    schema: "website-design-compiler/brief-input/v2",
    project: "brief-risky",
    briefText: [
      "Page type: product landing",
      "Audience: enterprise buyers",
      "Objective: explain the product",
      "Include customer testimonials and pricing."
    ].join("\n")
  });

  assert.equal(receipt.state, "NEEDS_INPUT");
  assert.equal(receipt.compilerInput, null);
  assert.ok(receipt.needsInput.includes("evidence:testimonials"));
  assert.ok(receipt.needsInput.includes("evidence:pricing"));
});

test("contradictory hard constraints produce actionable validation errors", () => {
  const receipt = normalizeBrief({
    schema: "website-design-compiler/brief-input/v2",
    project: "brief-contradiction",
    briefText: [
      "Page type: product landing",
      "Audience: enterprise buyers",
      "Objective: explain the product",
      "Must use autoplay video.",
      "Never use autoplay video."
    ].join("\n")
  });

  assert.equal(receipt.state, "NEEDS_INPUT");
  assert.equal(receipt.compilerInput, null);
  assert.ok(receipt.needsInput.includes("hardConstraints"));
  assert.ok(receipt.validationErrors.some((error) => error.includes("autoplay video")));
});
