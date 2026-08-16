import assert from "node:assert/strict";
import test from "node:test";
import { ARENA_CATEGORIES, evaluateArena, type ArenaMatrix } from "../src/arena.js";
import type { RuntimeReceipt } from "../src/contracts.js";

const requiredStages = ["reference-intelligence", "art-direction", "frontend-builder", "motion-director", "graphics-2d", "graphics-3d", "release-receipt"];
const matrix: ArenaMatrix = {
  schema: "website-design-compiler/arena-benchmark-matrix/v1",
  categories: ARENA_CATEGORIES.map((id) => ({ id, pageType: id, audience: "fixture", objective: "fixture" })),
  requiredCompilerStages: requiredStages,
  requiredGlobalEvidence: ["browser", "accessibilityPerformance", "storybookVisualGoldens", "licenseProvenance", "sharedBindings"]
};

function receipt(project: string): RuntimeReceipt {
  return {
    schema: "website-design-compiler/runtime-receipt/v1",
    project,
    generatedAt: "2026-08-16T00:00:00.000Z",
    inputSha256: `sha-${project}`,
    runtime: { node: "fixture", platform: "fixture", arch: "fixture" },
    stages: requiredStages.map((stage) => ({ stage, state: "PASS", reason: "fixture", artifacts: [] })),
    overall: "PASS"
  };
}

const receipts = new Map(ARENA_CATEGORIES.map((id) => [id, receipt(id)]));
const globalPass = {
  browser: "PASS",
  accessibilityPerformance: "PASS",
  storybookVisualGoldens: "PASS",
  licenseProvenance: "PASS",
  sharedBindings: "PASS"
} as const;

test("arena passes only with all six categories, compiler stages, and global evidence", () => {
  const result = evaluateArena(matrix, receipts, globalPass);
  assert.equal(result.overall, "PASS");
  assert.equal(result.categoryCoverage, "PASS");
  assert.equal(result.benchmarkScore, 100);
});

test("missing evidence remains ABSENT and fails the arena", () => {
  const { browser: _browser, ...withoutBrowser } = globalPass;
  const result = evaluateArena(matrix, receipts, withoutBrowser);
  assert.equal(result.overall, "FAIL");
  assert.deepEqual(result.missingGlobalEvidence, ["browser"]);
  assert.deepEqual(result.nonPassGlobalEvidence, [{ name: "browser", state: "ABSENT" }]);
});

test("hollow compiler PASS with a missing required stage fails", () => {
  const mutated = new Map(receipts);
  const hollow = receipt("interactive-3d");
  hollow.stages = hollow.stages.filter((stage) => stage.stage !== "graphics-3d");
  hollow.overall = "PASS";
  mutated.set("interactive-3d", hollow);
  const result = evaluateArena(matrix, mutated, globalPass);
  assert.equal(result.overall, "FAIL");
  assert.deepEqual(result.categories.find((entry) => entry.id === "interactive-3d")?.missingStages, ["graphics-3d"]);
});

test("a required global NOT_EXERCISED state cannot become arena PASS", () => {
  const result = evaluateArena(matrix, receipts, { ...globalPass, browser: "NOT_EXERCISED" });
  assert.equal(result.overall, "FAIL");
  assert.deepEqual(result.nonPassGlobalEvidence, [{ name: "browser", state: "NOT_EXERCISED" }]);
});
