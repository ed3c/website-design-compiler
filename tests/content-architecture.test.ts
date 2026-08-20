import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

const PROOF_SOURCE = "fixtures/content/proof-evidence.txt";
const PROOF_SOURCE_SHA256 = createHash("sha256").update(readFileSync(PROOF_SOURCE)).digest("hex");

function input(pageType: string, objective = "explain the governed product and provide a clear next action"): CompilerInput {
  return {
    schema: "website-design-compiler/input/v1",
    project: `content-${pageType}`,
    brief: { pageType, audience: "evaluation teams", objective },
    requestedStages: ["information-architecture", "content-architecture", "page-architect"]
  };
}

function authored(slot: string, withEvidence = slot === "proof-items") {
  const source = withEvidence ? PROOF_SOURCE : `fixture://content/${slot}`;
  const value = ["feature-items","proof-items","related-items","story-beats"].includes(slot)?[`Approved ${slot}`]:`Approved ${slot}`;
  const valueText=Array.isArray(value)?value.join("; "):value;
  const excerpt = `Evidence states: ${valueText}`;
  return {
    value,
    source: { kind: "benchmark-fixture" as const, uri: source },
    ...(withEvidence ? {
      evidence: {
        kind: "source-excerpt" as const,
        source,
        sourceSha256: PROOF_SOURCE_SHA256,
        excerpt,
        sha256: createHash("sha256").update(`${source}\0${PROOF_SOURCE_SHA256}\0${excerpt}\0${valueText}`).digest("hex")
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

test("proof evidence must bind the exact claim, source URI, and excerpt bytes", () => {
  const compilerInput = input("product-landing");
  const valid = authored("proof-items");
  const cases = [
    { ...valid, value: "Unrelated 99% growth claim" },
    { ...valid, evidence: { ...valid.evidence!, source: "fixture://content/unrelated" } },
    { ...valid, evidence: { ...valid.evidence!, excerpt: "Evidence for an unrelated claim" } }
  ];
  for (const proofEntry of cases) {
    const content = compileContentArchitecture({
      ...compilerInput,
      authoredContent: { "proof-items": proofEntry }
    });
    const proof = content.sections.find((section) => section.sectionId === "proof")?.fields[0];
    assert.equal(proof?.state, "NEEDS_INPUT");
    assert.equal(proof?.publishable, false);
  }
});

test("self-consistent proof claims cannot cite an unreadable caller-authored URI", () => {
  const compilerInput = input("product-landing");
  const source = "fixture://attacker";
  const value = "99% verified growth";
  const excerpt = `Attacker says ${value}`;
  const sourceSha256 = createHash("sha256").update(excerpt).digest("hex");
  const sha256 = createHash("sha256").update(`${source}\0${sourceSha256}\0${excerpt}\0${value}`).digest("hex");
  const content = compileContentArchitecture({
    ...compilerInput,
    authoredContent: {
      "proof-items": {
        value,
        source: { kind: "benchmark-fixture", uri: source },
        evidence: { kind: "source-excerpt", source, sourceSha256, excerpt, sha256 }
      }
    }
  });
  const proof = content.sections.find((section) => section.sectionId === "proof")?.fields[0];
  assert.equal(proof?.state, "NEEDS_INPUT");
  assert.equal(proof?.publishable, false);
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

test("user-supplied section content makes required slots ready with exact provenance",()=>{
  const compilerInput=input("product-landing");
  compilerInput.briefSourceEvidence={inputSha256:"b".repeat(64),fields:{pageType:{state:"EXPLICIT",sourceExcerpt:"Page type: product-landing"},audience:{state:"EXPLICIT",sourceExcerpt:"Audience: evaluation teams"},objective:{state:"EXPLICIT",sourceExcerpt:`Objective: ${compilerInput.brief.objective}`}}};
  compilerInput.authoredContent={"proof-items":authored("proof-items")};
  compilerInput.contentEvidence={schema:"website-design-compiler/content-evidence/v1",source:"USER_SUPPLIED",sections:{navigation:{"primary-action-label":"Inspect evidence"},hero:{headline:"Evidence before pixels","value-proposition":"Compile governed sites from traceable inputs","primary-action":"Review the compiler"},features:{headline:"Auditable capabilities","feature-items":["Exact runtime receipts","Bounded media fallbacks"]},proof:{"proof-items":["Approved proof-items"]},conversion:{"cta-headline":"Inspect the full evidence chain","cta-label":"Inspect evidence"}}};
  const content=compileContentArchitecture(compilerInput);
  assert.equal(content.overall,"READY");
  assert.deepEqual(content.sections.find((section)=>section.sectionId==="features")?.fields.find((field)=>field.slot==="feature-items")?.value,["Exact runtime receipts","Bounded media fallbacks"]);
  assert.ok(content.sections.flatMap((section)=>section.fields).filter((field)=>field.publishable).every((field)=>field.provenance.some((entry)=>entry.includes(compilerInput.briefSourceEvidence!.inputSha256))||field.slot==="brand-or-project-name"||field.slot==="project-name"));
});

test("unknown content evidence sections and slots fail fast with a diagnostic",()=>{
  const compilerInput=input("product-landing");
  compilerInput.briefSourceEvidence={inputSha256:"c".repeat(64),fields:{pageType:{state:"EXPLICIT",sourceExcerpt:"Page type: product-landing"},audience:{state:"EXPLICIT",sourceExcerpt:"Audience: evaluation teams"},objective:{state:"EXPLICIT",sourceExcerpt:"Objective: inspect"}}};
  compilerInput.contentEvidence={schema:"website-design-compiler/content-evidence/v1",source:"USER_SUPPLIED",sections:{features:{unknown:"not admitted"}}};
  assert.throws(()=>compileContentArchitecture(compilerInput),/unknown slot features\.unknown/);
});

test("content evidence fails closed when a scalar slot receives a list",()=>{
  const compilerInput=input("product-landing");
  compilerInput.briefSourceEvidence={inputSha256:"d".repeat(64),fields:{pageType:{state:"EXPLICIT",sourceExcerpt:"Page type: product-landing"},audience:{state:"EXPLICIT",sourceExcerpt:"Audience: evaluation teams"},objective:{state:"EXPLICIT",sourceExcerpt:"Objective: inspect"}}};
  compilerInput.contentEvidence={schema:"website-design-compiler/content-evidence/v1",source:"USER_SUPPLIED",sections:{hero:{headline:["This must be a scalar"]}}};
  const content=compileContentArchitecture(compilerInput);
  const headline=content.sections.find((section)=>section.sectionId==="hero")?.fields.find((field)=>field.slot==="headline");
  assert.equal(headline?.state,"NEEDS_INPUT");
  assert.equal(headline?.publishable,false);
  assert.equal(content.overall,"NEEDS_INPUT");
});

test("content budgets use governed section field limits at exact boundaries",()=>{
  const compilerInput=input("product-landing");
  compilerInput.briefSourceEvidence={inputSha256:"e".repeat(64),fields:{pageType:{state:"EXPLICIT",sourceExcerpt:"Page type: product-landing"},audience:{state:"EXPLICIT",sourceExcerpt:"Audience: evaluation teams"},objective:{state:"EXPLICIT",sourceExcerpt:"Objective: inspect"}}};
  compilerInput.contentEvidence={schema:"website-design-compiler/content-evidence/v1",source:"USER_SUPPLIED",sections:{hero:{headline:"h".repeat(96)},features:{headline:"f".repeat(72)},conversion:{"cta-headline":"c".repeat(80)}}};
  const content=compileContentArchitecture(compilerInput);
  const field=(sectionId:string,slot:string)=>content.sections.find((section)=>section.sectionId===sectionId)?.fields.find((entry)=>entry.slot===slot);
  assert.deepEqual(field("hero","headline")?.lengthBudget,{maxCharacters:96});
  assert.equal(field("hero","headline")?.state,"READY");
  assert.deepEqual(field("features","headline")?.lengthBudget,{maxCharacters:72});
  assert.equal(field("features","headline")?.state,"READY");
  assert.deepEqual(field("conversion","cta-headline")?.lengthBudget,{maxCharacters:80});
  assert.equal(field("conversion","cta-headline")?.state,"READY");
});

test("content budgets fail closed one character above governed section limits",()=>{
  const compilerInput=input("product-landing");
  compilerInput.briefSourceEvidence={inputSha256:"f".repeat(64),fields:{pageType:{state:"EXPLICIT",sourceExcerpt:"Page type: product-landing"},audience:{state:"EXPLICIT",sourceExcerpt:"Audience: evaluation teams"},objective:{state:"EXPLICIT",sourceExcerpt:"Objective: inspect"}}};
  compilerInput.contentEvidence={schema:"website-design-compiler/content-evidence/v1",source:"USER_SUPPLIED",sections:{hero:{headline:"h".repeat(97)},features:{headline:"f".repeat(73)},conversion:{"cta-headline":"c".repeat(81)}}};
  const content=compileContentArchitecture(compilerInput);
  const field=(sectionId:string,slot:string)=>content.sections.find((section)=>section.sectionId===sectionId)?.fields.find((entry)=>entry.slot===slot);
  assert.equal(field("hero","headline")?.state,"NEEDS_INPUT");
  assert.equal(field("features","headline")?.state,"NEEDS_INPUT");
  assert.equal(field("conversion","cta-headline")?.state,"NEEDS_INPUT");
});

test("a repeated item in one supplied list is a content quality failure",()=>{
  const compilerInput=input("product-landing");
  compilerInput.briefSourceEvidence={inputSha256:"a".repeat(64),fields:{pageType:{state:"EXPLICIT",sourceExcerpt:"Page type: product-landing"},audience:{state:"EXPLICIT",sourceExcerpt:"Audience: evaluation teams"},objective:{state:"EXPLICIT",sourceExcerpt:"Objective: inspect"}}};
  compilerInput.contentEvidence={schema:"website-design-compiler/content-evidence/v1",source:"USER_SUPPLIED",sections:{features:{"feature-items":["Repeated proof","Repeated proof"]}}};
  const content=compileContentArchitecture(compilerInput);
  assert.deepEqual(content.sections.find((section)=>section.sectionId==="features")?.quality.repeatedPublishableValues,["Repeated proof"]);
  assert.equal(content.overall,"NEEDS_INPUT");
});

test("derived project and objective values obey the same governed budgets",()=>{
  const compilerInput=input("product-landing");
  compilerInput.project="p".repeat(49);
  compilerInput.brief.objective="o".repeat(97);
  compilerInput.briefSourceEvidence={inputSha256:"9".repeat(64),fields:{pageType:{state:"EXPLICIT",sourceExcerpt:"Page type: product-landing"},audience:{state:"EXPLICIT",sourceExcerpt:"Audience: evaluation teams"},objective:{state:"EXPLICIT",sourceExcerpt:`Objective: ${compilerInput.brief.objective}`}}};
  const content=compileContentArchitecture(compilerInput);
  const navigationBrand=content.sections.find((section)=>section.sectionId==="navigation")?.fields.find((field)=>field.slot==="brand-or-project-name");
  const heroHeadline=content.sections.find((section)=>section.sectionId==="hero")?.fields.find((field)=>field.slot==="headline");
  assert.equal(navigationBrand?.state,"NEEDS_INPUT");
  assert.equal(heroHeadline?.state,"NEEDS_INPUT");
  assert.equal(content.overall,"NEEDS_INPUT");
});

function contentQuality(plan:ReturnType<typeof buildPageArchitecturePlan>,sectionId:string){
  return plan.sectionIntents.find((section)=>section.id===sectionId)!.contentContract.quality;
}
