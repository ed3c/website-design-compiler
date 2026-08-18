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

test("page architect directly carries content contract readiness and fields", () => {
  const plan = buildPageArchitecturePlan(input("product-landing"));
  const proof = plan.sectionIntents.find((section) => section.id === "proof");
  const hero = plan.sectionIntents.find((section) => section.id === "hero");
  assert.equal(proof?.contentContract.state, "NEEDS_INPUT");
  assert.equal(proof?.contentContract.fields[0]?.publishable, false);
  assert.equal(hero?.contentContract.fields.some((field) => field.publishable), false);
  assert.deepEqual(proof?.contentContract.localePolicy,{sourceLocale:"en",localizationReady:true});
  assert.deepEqual(proof?.contentContract.fields[0]?.lengthBudget,{maxCharacters:280});
  assert.deepEqual(proof?.contentContract.quality,contentQuality(plan,"proof"));
});

test("user-supplied section content makes required slots ready with exact provenance",()=>{
  const compilerInput=input("product-landing");
  compilerInput.briefSourceEvidence={inputSha256:"b".repeat(64),fields:{pageType:{state:"EXPLICIT",sourceExcerpt:"Page type: product-landing"},audience:{state:"EXPLICIT",sourceExcerpt:"Audience: evaluation teams"},objective:{state:"EXPLICIT",sourceExcerpt:`Objective: ${compilerInput.brief.objective}`}}};
  compilerInput.contentEvidence={schema:"website-design-compiler/content-evidence/v1",source:"USER_SUPPLIED",sections:{navigation:{"primary-action-label":"Inspect evidence"},hero:{headline:"Evidence before pixels","value-proposition":"Compile governed sites from traceable inputs","primary-action":"Review the compiler"},features:{headline:"Auditable capabilities","feature-items":["Exact runtime receipts","Bounded media fallbacks"]},proof:{"proof-items":["Artifacts bind to an exact commit","Unknown rights fail closed"]},conversion:{"cta-headline":"Inspect the full evidence chain","cta-label":"Inspect evidence"}}};
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
