import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CompilerInput } from "../src/contracts.js";
import { compileContentArchitecture, writeContentArchitecturePlan } from "../src/content-architecture.js";
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

function authored(slot: string, withEvidence = slot === "proof-items") {
  const source = `fixture://content/${slot}`;
  const excerpt = `Evidence for ${slot}`;
  return {
    value: `Approved ${slot}`,
    source: { kind: "benchmark-fixture" as const, uri: source },
    ...(withEvidence ? {
      evidence: {
        kind: "source-excerpt" as const,
        source,
        excerpt,
        sha256: createHash("sha256").update(`${source}\0${excerpt}`).digest("hex")
      }
    } : {})
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
  const compilerInput=input("product-landing");
  compilerInput.briefSourceEvidence={inputSha256:"a".repeat(64),fields:{pageType:{state:"EXPLICIT",sourceExcerpt:"Page type: product-landing"},audience:{state:"EXPLICIT",sourceExcerpt:"Audience: evaluation teams"},objective:{state:"EXPLICIT",sourceExcerpt:`Objective: ${compilerInput.brief.objective}`}}};
  const content = compileContentArchitecture(compilerInput);
  for (const section of content.sections) {
    for (const field of section.fields.filter((candidate) => candidate.publishable)) {
      assert.ok(field.provenance.length > 0);
      assert.ok(field.value);
      assert.ok((field.value?.length ?? 0) <= field.lengthBudget.maxCharacters);
    }
  }
});

test("an unbound objective and compiler-invented CTA never become publishable",()=>{
  const content=compileContentArchitecture(input("product-landing"));
  const hero=content.sections.find((section)=>section.sectionId==="hero")!;
  assert.equal(hero.fields.find((field)=>field.slot==="headline")?.state,"NEEDS_INPUT");
  assert.equal(hero.fields.find((field)=>field.slot==="primary-action")?.publishable,false);
  assert.ok(hero.fields.filter((field)=>field.publishable).every((field)=>field.sourceType==="user_supplied_claim"));
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

test("a planning objective never becomes publishable headline, product, task, or CTA copy", () => {
  const objective = "increase qualified demo requests by explaining governed compilation";
  const content = compileContentArchitecture(input("product-landing", objective));
  const objectiveBackedSlots = new Set([
    "headline",
    "value-proposition",
    "product-description",
    "task",
    "primary-action",
    "primary-action-label",
    "cta-label",
    "scene-purpose",
    "interaction-purpose"
  ]);
  const fields = content.sections.flatMap((section) => section.fields).filter((field) => objectiveBackedSlots.has(field.slot));

  assert.ok(fields.length > 0);
  assert.ok(fields.every((field) => field.state === "NEEDS_INPUT"));
  assert.ok(fields.every((field) => field.value === null && !field.publishable));
  assert.ok(fields.every((field) => field.sourceType === "placeholder_required"));
  assert.equal(content.sections.flatMap((section) => section.fields).some((field) => field.value === "Explore the product"), false);
});

test("writer classifies missing authoring inputs as ABSENT runtime evidence", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "wdc-content-architecture-"));
  try {
    const result = await writeContentArchitecturePlan(input("product-landing"), outputDirectory);
    assert.equal(result.state, "ABSENT");
    assert.match(result.reason, /authoring inputs/i);
    assert.equal(result.artifacts.length, 1);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("explicit authored content makes every required field provenance-bound and executable", async () => {
  const compilerInput = input("product-landing");
  const requiredSlots = compileInformationArchitecture(compilerInput).sections.flatMap((section) => section.requiredContent);
  const authoredContent = Object.fromEntries(requiredSlots.map((slot) => [slot, authored(slot)]));
  const authoredInput = { ...compilerInput, authoredContent };
  const content = compileContentArchitecture(authoredInput);

  assert.equal(content.overall, "READY");
  assert.ok(content.sections.flatMap((section) => section.fields).every((field) => field.state === "READY"));
  assert.ok(content.sections.flatMap((section) => section.fields).every((field) =>
    field.provenance.includes(`compiler.authoredContent:${field.slot}`)
  ));

  const outputDirectory = await mkdtemp(join(tmpdir(), "wdc-authored-content-"));
  try {
    const result = await writeContentArchitecturePlan(authoredInput, outputDirectory);
    assert.equal(result.state, "PASS");
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("authored content with no matching IA slot fails fast", () => {
  const compilerInput = { ...input("product-landing"), authoredContent: { "unowned-copy": authored("unowned-copy") } };
  assert.throws(() => compileContentArchitecture(compilerInput), /not owned by this page architecture.*unowned-copy/i);
});

test("proof copy without source evidence cannot self-promote to publishable", () => {
  const compilerInput = input("product-landing");
  const content = compileContentArchitecture({
    ...compilerInput,
    authoredContent: { "proof-items": authored("proof-items", false) }
  });
  const proof = content.sections.find((section) => section.sectionId === "proof")?.fields[0];
  assert.equal(proof?.state, "NEEDS_INPUT");
  assert.equal(proof?.publishable, false);
  assert.deepEqual(proof?.provenance, ["policy.evidence-required:proof-items"]);
});

test("page architect carries the full content contract without dropping provenance or policy", () => {
  const compilerInput = input("product-landing");
  const content = compileContentArchitecture(compilerInput);
  const plan = buildPageArchitecturePlan(compilerInput);
  const proof = plan.sectionIntents.find((section) => section.id === "proof");
  const hero = plan.sectionIntents.find((section) => section.id === "hero");
  const contentHero = content.sections.find((section) => section.sectionId === "hero");
  const { state: heroState, ...projectedHero } = hero?.contentContract ?? { state: "NEEDS_INPUT" as const };
  assert.equal(proof?.contentContract.state, "NEEDS_INPUT");
  assert.equal(proof?.contentContract.fields[0]?.publishable, false);
  assert.equal(heroState, "NEEDS_INPUT");
  assert.deepEqual(projectedHero, contentHero);
  assert.equal(hero?.contentContract.fields.some((field) => field.publishable), false);
  assert.deepEqual(proof?.contentContract.localePolicy,{sourceLocale:"en",localizationReady:true});
  assert.deepEqual(proof?.contentContract.fields[0]?.lengthBudget,{maxCharacters:280});
  assert.deepEqual(proof?.contentContract.quality,contentQuality(plan,"proof"));
});

function contentQuality(plan:ReturnType<typeof buildPageArchitecturePlan>,sectionId:string){
  return plan.sectionIntents.find((section)=>section.id===sectionId)!.contentContract.quality;
}
