import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compile } from "../src/compiler.js";
import { validateCompilerInput } from "../src/validate.js";

test("minimal fixture validates and produces PASS for implemented reference, art direction, frontend, motion, and release stages", async () => {
  const fixtureUrl = new URL("../fixtures/minimal/compiler-input.json", import.meta.url);
  const raw = JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown;
  const input = await validateCompilerInput(raw);
  const receipt = compile(input, new Date("2026-08-16T00:00:00.000Z"));

  assert.equal(receipt.schema, "website-design-compiler/runtime-receipt/v1");
  assert.equal(receipt.project, "minimal-showcase");
  assert.equal(receipt.overall, "PASS");
  assert.deepEqual(receipt.stages.map((stage) => [stage.stage, stage.state]), [
    ["reference-intelligence", "PASS"],
    ["art-direction", "PASS"],
    ["frontend-builder", "PASS"],
    ["motion-director", "PASS"],
    ["release-receipt", "PASS"]
  ]);
  assert.match(receipt.inputSha256, /^[a-f0-9]{64}$/);
});

test("known but unavailable stage is NOT_IMPLEMENTED, never PASS", async () => {
  const input = await validateCompilerInput({
    schema: "website-design-compiler/input/v1",
    project: "unimplemented-stage",
    brief: { pageType: "landing", audience: "teams", objective: "test evidence" },
    requestedStages: ["page-architect"]
  });
  const receipt = compile(input, new Date("2026-08-16T00:00:00.000Z"));

  assert.equal(receipt.overall, "NOT_IMPLEMENTED");
  assert.equal(receipt.stages[0]?.state, "NOT_IMPLEMENTED");
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
