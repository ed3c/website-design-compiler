import assert from "node:assert/strict";
import test from "node:test";
import { buildFrontendPlan, GOVERNED_COMPONENTS } from "../src/frontend-builder.js";
import type { CompilerInput } from "../src/contracts.js";

const input: CompilerInput = {
  schema: "website-design-compiler/input/v1",
  project: "frontend-plan-fixture",
  brief: { pageType: "landing", audience: "teams", objective: "governed rendering" },
  requestedStages: ["frontend-builder"]
};

test("frontend plan only emits governed registry components", () => {
  const plan = buildFrontendPlan(input);
  assert.equal(plan.arbitraryMarkupAllowed, false);
  assert.equal(plan.renderer, "nextjs-registry");
  assert.ok(plan.components.length > 0);
  for (const node of plan.components) {
    assert.ok(GOVERNED_COMPONENTS.includes(node.component));
  }
});

test("frontend plan contains no arbitrary html payload", () => {
  const serialized = JSON.stringify(buildFrontendPlan(input));
  assert.equal(serialized.includes("<div"), false);
  assert.equal(serialized.includes("dangerouslySetInnerHTML"), false);
});
