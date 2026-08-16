import assert from "node:assert/strict";
import test from "node:test";
import type { CompilerInput } from "../src/contracts.js";
import { compileContentArchitecture } from "../src/content-architecture.js";
import { compileInformationArchitecture } from "../src/information-architecture.js";
import { buildPageArchitecturePlan } from "../src/page-architect.js";

const families = [
  ["b2b", "product-landing"],
  ["editorial", "editorial-feature"],
  ["premium", "premium-consumer"],
  ["motion", "creative-showcase"],
  ["2d", "interactive-2d"],
  ["3d", "interactive-3d"]
] as const;

function input(pageType: string, objective = "explain the governed product and provide a clear next action"): CompilerInput {
  return {
    schema: "website-design-compiler/input/v1",
    project: `content-${pageType}`,
    brief: { pageType, audience: "evaluation teams", objective },
    requestedStages: ["information-architecture", "content-architecture", "page-architect"]
  };
}

test("six benchmark families produce content contracts matching their IA graphs", () => {
  for (const [, pageType] of families) {
    const compilerInput = input(pageType);
    const ia = compileInformationArchitecture(compilerInput);
    const content = compileContentArchitecture(compilerInput);
    assert.deepEqual(content.sections.map((section) => section.sectionId), ia.sections.map((section) => section.id));
    assert.equal(content.sections.length, ia.sections.length);
    assert.ok(content.sections.every((section) => section.fields.length > 0));
  }
});

test("publishable fields always carry provenance and obey length budgets", () => {
  const content = compileContentArchitecture(input("product-landing"));
  for (const section of content.sections) {
    for (const field of section.fields.filter((candidate) => candidate.publishable)) {
      assert.ok(field.provenance.length > 0);
      assert.ok(field.value);
      assert.ok((field.value?.length ?? 0) <= field.lengthBudget.maxCharacters);
    }
  }
});

test("missing proof and feature inputs remain NEEDS_INPUT instead of fabricated evidence", () => {
  const content = compileContentArchitecture(input("product-landing"));
  const features = content.sections.find((section) => section.sectionId === "features");
  const proof = content.sections.find((section) => section.sectionId === "proof");
  assert.equal(features?.fields[0]?.state, "NEEDS_INPUT");
  assert.equal(features?.fields[0]?.publishable, false);
  assert.equal(proof?.fields[0]?.state, "NEEDS_INPUT");
  assert.equal(proof?.fields[0]?.sourceType, "placeholder_required");
  assert.equal(content.overall, "NEEDS_INPUT");
});

test("forbidden social proof and commercial claims are never generated as publishable fields", () => {
  const content = compileContentArchitecture(input("product-landing", "show testimonials, customer logos, metrics and pricing without inventing values"));
  for (const forbidden of ["customer-logos", "testimonials", "metrics", "pricing", "customer-names", "performance-claims"]) {
    assert.ok(content.forbiddenInventions.includes(forbidden));
  }
  const forbiddenPublishable = content.sections.flatMap((section) => section.fields).filter((field) =>
    content.forbiddenInventions.includes(field.slot) && field.publishable
  );
  assert.deepEqual(forbiddenPublishable, []);
});

test("copy longer than its responsive budget becomes NEEDS_INPUT rather than overflowing", () => {
  const longObjective = "x".repeat(180);
  const content = compileContentArchitecture(input("product-landing", longObjective));
  const headline = content.sections.find((section) => section.sectionId === "hero")?.fields.find((field) => field.slot === "headline");
  assert.equal(headline?.state, "NEEDS_INPUT");
  assert.equal(headline?.value, null);
  assert.equal(headline?.publishable, false);
});

test("page architect directly carries content contract readiness and fields", () => {
  const plan = buildPageArchitecturePlan(input("product-landing"));
  const proof = plan.sectionIntents.find((section) => section.id === "proof");
  const hero = plan.sectionIntents.find((section) => section.id === "hero");
  assert.equal(proof?.contentContract.state, "NEEDS_INPUT");
  assert.equal(proof?.contentContract.fields[0]?.publishable, false);
  assert.equal(hero?.contentContract.fields.some((field) => field.publishable), true);
});
