import assert from "node:assert/strict";
import test from "node:test";
import { buildPageArchitecturePlan } from "../src/page-architect.js";
import type { CompilerInput } from "../src/contracts.js";

function input(pageType: string): CompilerInput {
  return {
    schema: "website-design-compiler/input/v1",
    project: `page-${pageType}`,
    brief: {
      pageType,
      audience: "evaluation team",
      objective: "understand the product and choose the next action"
    },
    requestedStages: ["information-architecture", "page-architect"]
  };
}

test("page architect consumes materially different IA section intents", () => {
  const product = buildPageArchitecturePlan(input("b2b product landing"));
  const editorial = buildPageArchitecturePlan(input("editorial publication"));

  assert.ok(product.sectionIntents.some((section) => section.type === "feature-grid"));
  assert.ok(editorial.sectionIntents.some((section) => section.type === "editorial-prose"));
  assert.notDeepEqual(
    product.sectionIntents.map((section) => section.type),
    editorial.sectionIntents.map((section) => section.type)
  );
});

test("NEEDS_INPUT IA status survives into page architect", () => {
  const plan = buildPageArchitecturePlan(input("b2b product landing"));
  const proof = plan.sectionIntents.find((section) => section.id === "proof");

  assert.equal(proof?.status, "NEEDS_INPUT");
  assert.deepEqual(proof?.requiredContent, ["proof-items"]);
  assert.equal(proof?.fallback, "Omit proof section until evidence is supplied.");
});
