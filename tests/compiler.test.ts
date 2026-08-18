import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compile } from "../src/compiler.js";
import type { StageExecutionEvidence } from "../src/contracts.js";
import { validateCompilerInput } from "../src/validate.js";

function executedStages(input: { requestedStages: string[] }): ReadonlyMap<string, StageExecutionEvidence> {
  const artifacts: Record<string, string[]> = {
    "reference-intelligence": ["reference-intelligence/reference-manifest.json"],
    "art-direction": ["art-direction/design-read.json"],
    "frontend-builder": ["frontend-builder/frontend-plan.json"],
    "motion-director": ["motion-director/motion-plan.json"],
    "graphics-2d": ["graphics-2d/graphics-2d-plan.json"],
    "graphics-3d": ["graphics-3d/graphics-3d-plan.json", "graphics-3d/procedural-provenance.json"],
    "media-generator": ["media-generator/media-generator-plan.json"],
    "release-receipt": ["runtime-receipt.json"]
  };
  return new Map(input.requestedStages.map((stage) => [stage, {
    state: "PASS" as const,
    reason: "test writer completed",
    artifacts: artifacts[stage] ?? [`${stage}/verified-artifact.json`]
  }]));
}

test("minimal fixture validates and produces PASS for implemented reference, art direction, frontend, motion, 2d, 3d, and release stages", async () => {
  const fixtureUrl = new URL("../fixtures/minimal/compiler-input.json", import.meta.url);
  const raw = JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown;
  const input = await validateCompilerInput(raw);
  const receipt = compile(input, new Date("2026-08-16T00:00:00.000Z"), executedStages(input));

  assert.equal(receipt.schema, "website-design-compiler/runtime-receipt/v1");
  assert.equal(receipt.project, "minimal-showcase");
  assert.equal(receipt.overall, "PASS");
  assert.deepEqual(receipt.stages.map((stage) => [stage.stage, stage.state]), [
    ["reference-intelligence", "PASS"],
    ["art-direction", "PASS"],
    ["frontend-builder", "PASS"],
    ["motion-director", "PASS"],
    ["graphics-2d", "PASS"],
    ["graphics-3d", "PASS"],
    ["release-receipt", "PASS"]
  ]);
  assert.match(receipt.inputSha256, /^[a-f0-9]{64}$/);
});

test("media-generator is executable and reports its governed plan artifact", async () => {
  const input = await validateCompilerInput({
    schema: "website-design-compiler/input/v1",
    project: "media-generator-stage",
    brief: { pageType: "landing", audience: "teams", objective: "test media evidence" },
    requestedStages: ["media-generator"]
  });
  const receipt = compile(input, new Date("2026-08-16T00:00:00.000Z"), executedStages(input));

  assert.equal(receipt.overall, "PASS");
  assert.equal(receipt.stages[0]?.state, "PASS");
  assert.deepEqual(receipt.stages[0]?.artifacts, ["media-generator/media-generator-plan.json"]);
});

test("known but unavailable stage is NOT_IMPLEMENTED, never PASS", async () => {
  const input = await validateCompilerInput({
    schema: "website-design-compiler/input/v1",
    project: "unimplemented-stage",
    brief: { pageType: "landing", audience: "teams", objective: "test evidence" },
    requestedStages: ["originality-gate"]
  });
  const receipt = compile(input, new Date("2026-08-16T00:00:00.000Z"));

  assert.equal(receipt.overall, "NOT_IMPLEMENTED");
  assert.equal(receipt.stages[0]?.state, "NOT_IMPLEMENTED");
});

test("implemented stage is NOT_EXERCISED until exact artifacts are supplied", async () => {
  const input = await validateCompilerInput({
    schema: "website-design-compiler/input/v1",
    project: "unexecuted-stage",
    brief: { pageType: "landing", audience: "teams", objective: "test evidence" },
    requestedStages: ["information-architecture"]
  });

  const receipt = compile(input, new Date("2026-08-16T00:00:00.000Z"));

  assert.equal(receipt.overall, "NOT_EXERCISED");
  assert.equal(receipt.stages[0]?.state, "NOT_EXERCISED");
  assert.deepEqual(receipt.stages[0]?.artifacts, []);
});

test("an executed stage can report ABSENT inputs without being promoted to PASS", async () => {
  const input = await validateCompilerInput({
    schema: "website-design-compiler/input/v1",
    project: "missing-content-inputs",
    brief: { pageType: "landing", audience: "teams", objective: "plan a conversion path" },
    requestedStages: ["content-architecture"]
  });
  const receipt = compile(input, new Date("2026-08-16T00:00:00.000Z"), new Map([
    ["content-architecture", {
      state: "ABSENT",
      reason: "Required authoring inputs are absent.",
      artifacts: ["content-architecture/content-architecture.json"]
    }]
  ]));

  assert.equal(receipt.overall, "ABSENT");
  assert.equal(receipt.stages[0]?.state, "ABSENT");
  assert.deepEqual(receipt.stages[0]?.artifacts, ["content-architecture/content-architecture.json"]);
});

test("unknown stage fails closed", async () => {
  const input = await validateCompilerInput({
    schema: "website-design-compiler/input/v1",
    project: "unknown-stage",
    brief: { pageType: "landing", audience: "teams", objective: "test refusal" },
    requestedStages: ["invented-stage"]
  });
  const receipt = compile(input, new Date("2026-08-16T00:00:00.000Z"));

  assert.equal(receipt.overall, "FAIL");
  assert.equal(receipt.stages[0]?.state, "FAIL");
});
