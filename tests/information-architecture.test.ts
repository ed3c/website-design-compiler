import assert from "node:assert/strict";
import test from "node:test";
import { compileInformationArchitecture } from "../src/information-architecture.js";
import type { CompilerInput } from "../src/contracts.js";

function input(pageType: string): CompilerInput {
  return {
    schema: "website-design-compiler/input/v1",
    project: pageType,
    brief: {
      pageType,
      audience: "evaluation team",
      objective: "understand the experience and choose the next action"
    },
    requestedStages: ["information-architecture"]
  };
}

test("six benchmark page families produce materially different IA graphs", () => {
  const pageTypes = [
    "b2b product landing",
    "editorial publication",
    "premium consumer brand",
    "motion-heavy creative site",
    "interactive 2d experience",
    "interactive 3d showcase"
  ];

  const plans = pageTypes.map((pageType) => compileInformationArchitecture(input(pageType)));
  assert.equal(new Set(plans.map((plan) => plan.family)).size, 6);
  assert.equal(new Set(plans.map((plan) => plan.sections.map((section) => section.type).join("|"))).size, 6);

  for (const plan of plans) {
    assert.ok(plan.sections.length >= 5);
    for (const section of plan.sections) {
      assert.ok(section.purpose.length > 0);
      assert.ok(section.priority.length > 0);
      assert.ok(section.evidence.length > 0);
      assert.ok(section.requiredContent.length > 0);
      assert.ok(section.fallback.length > 0);
    }
  }
});

test("B2B IA never fabricates social proof and marks it NEEDS_INPUT", () => {
  const plan = compileInformationArchitecture(input("b2b product landing"));
  const proof = plan.sections.find((section) => section.id === "proof");

  assert.equal(proof?.status, "NEEDS_INPUT");
  assert.equal(proof?.fallback, "Omit proof section until evidence is supplied.");
  assert.ok(plan.forbiddenInventions.includes("testimonials"));
  assert.ok(plan.forbiddenInventions.includes("metrics"));
  assert.ok(plan.forbiddenInventions.includes("pricing"));
});

test("mobile information priority is explicit", () => {
  const plan = compileInformationArchitecture(input("interactive 3d showcase"));
  assert.deepEqual(plan.navigation.mobilePriority, ["primary-action", "primary-content", "supporting-content"]);
});

test("section readiness and evidence are bound to the content each section needs", () => {
  const plan = compileInformationArchitecture(input("b2b product landing"));
  const navigation = plan.sections.find((section) => section.id === "navigation");
  const hero = plan.sections.find((section) => section.id === "hero");
  const footer = plan.sections.find((section) => section.id === "footer");

  assert.equal(navigation?.status, "NEEDS_INPUT");
  assert.deepEqual(navigation?.missingContent, ["primary-action-label"]);
  assert.equal(hero?.status, "NEEDS_INPUT");
  assert.deepEqual(hero?.missingContent, ["headline", "primary-action"]);
  assert.equal(footer?.status, "READY");
  assert.deepEqual(footer?.missingContent, []);
  assert.notDeepEqual(navigation?.evidence, hero?.evidence);
});
