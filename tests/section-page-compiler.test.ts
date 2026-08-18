import assert from "node:assert/strict";
import test from "node:test";
import { ARENA_CATEGORIES } from "../src/arena.js";
import type { CompilerInput } from "../src/contracts.js";
import { buildFrontendPlan } from "../src/frontend-builder.js";
import {
  compileArenaSectionPages,
  compileSectionPage
} from "../src/section-page-fixtures.js";

function input(pageType: string): CompilerInput {
  return {
    schema: "website-design-compiler/input/v1",
    project: `compiler-${pageType}`,
    brief: {
      pageType,
      audience: "evaluation teams",
      objective: "understand the governed experience and take the next action"
    },
    requestedStages: ["information-architecture", "content-architecture", "frontend-builder"]
  };
}

test("section pages are projected from compiler IA and content output", () => {
  const page=compileSectionPage(input("b2b-product"));
  assert.equal(page.schema,"website-design-compiler/section-page/v2");
  assert.equal(page.category,"b2b-product");
  assert.deepEqual(page.source,{
    input:"website-design-compiler/input/v1",
    informationArchitecture:"website-design-compiler/information-architecture/v2",
    contentArchitecture:"website-design-compiler/content-architecture/v2"
  });
  assert.deepEqual(page.sections.map((section)=>section.kind),[
    "navigation","hero","feature-grid","proof-cloud","cta","footer"
  ]);
  assert.ok(page.missingEvidence.includes("proof.proof-items"));
  assert.ok(page.sections.flatMap((section)=>Object.values(section.provenance)).every((value)=>!value.startsWith("fixture:")));
});

test("compiler covers the exact Arena category SSOT with six material page graphs", () => {
  const pages=compileArenaSectionPages();
  assert.deepEqual(pages.map((page)=>page.category),[...ARENA_CATEGORIES]);
  assert.equal(new Set(pages.map((page)=>page.sections.map((section)=>`${section.kind}:${section.variant}`).join("|"))).size,ARENA_CATEGORIES.length);
  for(const page of pages){
    assert.equal(page.sections[0]?.kind,"navigation");
    assert.equal(page.sections.at(-1)?.kind,"footer");
    assert.ok(page.sections.length>=5);
  }
});

test("frontend builder uses the same compiler-derived sections", () => {
  const compilerInput=input("interactive-3d");
  const page=compileSectionPage(compilerInput);
  const frontend=buildFrontendPlan(compilerInput);
  assert.deepEqual(frontend.components.map((node)=>node.id),page.sections.map((section)=>section.id));
  assert.deepEqual(frontend.components.map((node)=>node.component),page.sections.map(()=>"rich-section"));
});
