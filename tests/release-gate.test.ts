import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseGate } from "../src/release-gate.js";

const pass = {
  runtime: "PASS",
  browser: "PASS",
  accessibilityPerformance: "PASS",
  storybook: "PASS",
  sharedBindings: "PASS",
  arena: "PASS",
  showcase: "PASS",
  externalSkills: "PASS",
  mediaGenerator: "PASS"
} as const;

test("release gate passes only when all hard evidence layers pass", () => {
  assert.equal(evaluateReleaseGate(pass).overall, "PASS");
});

test("accessibility performance failure makes release fail", () => {
  assert.equal(evaluateReleaseGate({ ...pass, accessibilityPerformance: "FAIL" }).overall, "FAIL");
});

test("storybook regression makes release fail", () => {
  assert.equal(evaluateReleaseGate({ ...pass, storybook: "FAIL" }).overall, "FAIL");
});

test("shared binding failure makes release fail", () => {
  assert.equal(evaluateReleaseGate({ ...pass, sharedBindings: "FAIL" }).overall, "FAIL");
});

test("arena regression makes release fail", () => {
  assert.equal(evaluateReleaseGate({ ...pass, arena: "FAIL" }).overall, "FAIL");
});

test("showcase compiler drift makes release fail", () => {
  assert.equal(evaluateReleaseGate({ ...pass, showcase: "FAIL" }).overall, "FAIL");
});

test("external skill admission regression makes release fail", () => {
  assert.equal(evaluateReleaseGate({ ...pass, externalSkills: "FAIL" }).overall, "FAIL");
});

test("media generator evidence regression makes release fail", () => {
  assert.equal(evaluateReleaseGate({ ...pass, mediaGenerator: "FAIL" }).overall, "FAIL");
});

test("missing or unimplemented evidence cannot become release PASS", () => {
  assert.equal(evaluateReleaseGate({ ...pass, browser: "NOT_EXERCISED" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, runtime: "NOT_IMPLEMENTED" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, storybook: "ABSENT" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, sharedBindings: "ABSENT" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, arena: "ABSENT" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, showcase: "ABSENT" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, externalSkills: "ABSENT" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, mediaGenerator: "ABSENT" }).overall, "FAIL");
});
