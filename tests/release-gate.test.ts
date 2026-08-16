import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseGate } from "../src/release-gate.js";

test("release gate passes only when all hard evidence layers pass", () => {
  assert.equal(evaluateReleaseGate({ runtime: "PASS", browser: "PASS", accessibilityPerformance: "PASS" }).overall, "PASS");
});

test("accessibility performance failure makes release fail", () => {
  const result = evaluateReleaseGate({ runtime: "PASS", browser: "PASS", accessibilityPerformance: "FAIL" });
  assert.equal(result.overall, "FAIL");
});

test("missing or unimplemented evidence cannot become release PASS", () => {
  assert.equal(evaluateReleaseGate({ runtime: "PASS", browser: "NOT_EXERCISED", accessibilityPerformance: "PASS" }).overall, "FAIL");
  assert.equal(evaluateReleaseGate({ runtime: "NOT_IMPLEMENTED", browser: "PASS", accessibilityPerformance: "PASS" }).overall, "FAIL");
});
