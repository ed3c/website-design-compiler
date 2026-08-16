import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseGate } from "../src/release-gate.js";

const pass = {
  runtime: "PASS",
  browser: "PASS",
  accessibilityPerformance: "PASS",
  storybook: "PASS",
  sharedBindings: "PASS"
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

test("missing or unimplemented evidence cannot become release PASS", () => {
  assert.equal(evaluateReleaseGate({ ...pass, browser: "NOT_EXERCISED" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, runtime: "NOT_IMPLEMENTED" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, storybook: "ABSENT" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ ...pass, sharedBindings: "ABSENT" }).overall, "FAIL");
});
