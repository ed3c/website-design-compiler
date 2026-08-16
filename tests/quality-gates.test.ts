import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateQualityMeasurements, type QualityMeasurements, type ReleaseBudgets } from "../src/quality-gates.js";

async function loadBudgets(): Promise<ReleaseBudgets> {
  return JSON.parse(await readFile(new URL("../policies/release-budgets.json", import.meta.url), "utf8")) as ReleaseBudgets;
}

function validMeasurements(): QualityMeasurements {
  return {
    axeSeriousCriticalViolations: 0,
    fallbackAxeSeriousCriticalViolations: 0,
    mainLandmarks: 1,
    h1Count: 1,
    minTouchTargetPx: 44,
    lcpMs: 900,
    cls: 0.01,
    ttfbMs: 40,
    inpMs: 80,
    totalTransferBytes: 500000,
    scriptTransferBytes: 400000,
    imageTransferBytes: 0,
    videoTransferBytes: 0,
    domNodes: 120,
    states: ["loading", "empty", "error", "success"],
    reducedMotionVerified: true,
    coarsePointerVerified: true,
    graphics2dFallbackVerified: true,
    graphics3dFallbackVerified: true,
    graphics2dExternalAssetBytes: 0,
    graphics3dExternalAssetBytes: 0,
    graphics3dTextureAssetBytes: 0,
    graphics3dMaxTriangles: 2500,
    graphics3dMaxDrawCalls: 8
  };
}

test("compliant evidence evaluates PASS", async () => {
  const result = evaluateQualityMeasurements(validMeasurements(), await loadBudgets());
  assert.equal(result.overall, "PASS");
});

test("accessibility violation evaluates FAIL", async () => {
  const input = validMeasurements();
  input.axeSeriousCriticalViolations = 1;
  const result = evaluateQualityMeasurements(input, await loadBudgets());
  assert.equal(result.overall, "FAIL");
  assert.equal(result.gates.axe, "FAIL");
});

test("performance over budget evaluates FAIL", async () => {
  const input = validMeasurements();
  input.lcpMs = 3000;
  input.totalTransferBytes = 3000000;
  const result = evaluateQualityMeasurements(input, await loadBudgets());
  assert.equal(result.overall, "FAIL");
  assert.equal(result.gates.lcp, "FAIL");
  assert.equal(result.gates.totalTransfer, "FAIL");
});

test("missing state and degradation evidence evaluates FAIL", async () => {
  const input = validMeasurements();
  input.states = ["loading", "empty", "success"];
  input.graphics3dFallbackVerified = false;
  const result = evaluateQualityMeasurements(input, await loadBudgets());
  assert.equal(result.overall, "FAIL");
  assert.equal(result.gates.explicitStates, "FAIL");
  assert.equal(result.gates.graphics3dFallback, "FAIL");
});

test("unobserved INP remains explicit NOT_EXERCISED", async () => {
  const input = validMeasurements();
  input.inpMs = null;
  const result = evaluateQualityMeasurements(input, await loadBudgets());
  assert.equal(result.overall, "PASS");
  assert.equal(result.gates.inp, "NOT_EXERCISED");
});
