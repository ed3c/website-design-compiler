import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph, completePageGraphSignature, validateCompletePageGraph } from "../src/complete-page-graph.js";
import { validateAgainstSchema } from "../src/validate.js";

test("six categories compile materially different complete governed page graphs",()=>{
  const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
  assert.equal(graphs.length,6);
  assert.equal(new Set(graphs.map((graph)=>graph.signature)).size,6);
  for(const graph of graphs){
    assert.equal(graph.readiness,"READY");
    assert.deepEqual(validateCompletePageGraph(graph),[]);
    assert.equal(graph.nodes[0]?.kind,"navigation");
    assert.equal(graph.nodes.at(-1)?.kind,"footer");
    assert.equal(graph.contracts.arbitraryMarkupAllowed,false);
  }
});

test("B2B and editorial graphs preserve distinct information architecture",()=>{
  const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
  const b2b=graphs.find((graph)=>graph.category==="b2b-product")!;
  const editorial=graphs.find((graph)=>graph.category==="editorial")!;
  for(const kind of ["navigation","hero","feature-grid","proof-cloud","cta","footer"]) assert.ok(b2b.nodes.some((node)=>node.kind===kind));
  assert.ok(editorial.nodes.some((node)=>node.kind==="editorial-prose"));
  assert.ok(editorial.nodes.some((node)=>node.kind==="faq"));
  assert.ok(!editorial.nodes.some((node)=>node.kind==="comparison"));
});

test("missing evidence cannot silently become a publishable complete graph",()=>{
  const page=compileAllSectionPageFixtures()[0]!;
  const broken=structuredClone(page);
  delete broken.sections[1]!.provenance[Object.keys(broken.sections[1]!.props)[0]!];
  const graph=compileCompletePageGraph(broken);
  assert.equal(graph.readiness,"NEEDS_INPUT");
  assert.ok(graph.missingEvidence.length>0);
  assert.deepEqual(validateCompletePageGraph(graph),[]);
});

test("validator rejects a signed READY graph whose embedded content contract was tampered",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const node=graph.nodes[1]!;
  node.contentContract={sectionId:node.id,sectionType:"hero-product",messageGoal:"State the product promise.",audienceQuestion:"What must the visitor understand?",ctaRole:"SECONDARY",fallback:"Render the semantic fallback.",localePolicy:{sourceLocale:"en",localizationReady:true},fields:[{slot:"headline",state:"NEEDS_INPUT",sourceType:"placeholder_required",value:null,publishable:false,provenance:[],lengthBudget:{maxCharacters:96}}],quality:{forbiddenPhraseHits:[],repeatedPublishableValues:[]}};
  const {signature:_,...unsigned}=graph;
  graph.signature=completePageGraphSignature(unsigned);
  const errors=validateCompletePageGraph(graph);
  assert.ok(errors.includes("missing evidence projection drift"));
  assert.ok(errors.includes("readiness drift: expected NEEDS_INPUT"));
});

test("runtime and serialized schema reject list values in scalar content slots",async()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const node=graph.nodes[1]!;
  node.contentContract={sectionId:node.id,sectionType:"hero-product",messageGoal:"State the product promise.",audienceQuestion:"What must the visitor understand?",ctaRole:"SECONDARY",fallback:"Render the semantic fallback.",localePolicy:{sourceLocale:"en",localizationReady:true},fields:[{slot:"headline",state:"READY",sourceType:"user_supplied_claim",value:["Scalar slots reject lists"],publishable:true,provenance:["brief-input:test#/contentEvidence/sections/hero/headline"],lengthBudget:{maxCharacters:96}}],quality:{forbiddenPhraseHits:[],repeatedPublishableValues:[]}};
  const {signature:_,...unsigned}=graph;
  graph.signature=completePageGraphSignature(unsigned);
  assert.ok(validateCompletePageGraph(graph).includes(`${node.id}.content: headline: invalid READY field`));
  await assert.rejects(validateAgainstSchema(graph,"page-graph-v2.schema.json"),/must be string/);
});

test("validator rejects missing, duplicate, or moved production content contracts",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const node=graph.nodes[1]!;
  const duplicate={slot:"headline",state:"NEEDS_INPUT" as const,sourceType:"placeholder_required" as const,value:null,publishable:false,provenance:[],lengthBudget:{maxCharacters:96}};
  node.contentContract={sectionId:"moved-section",sectionType:"hero-product",messageGoal:"State the product promise.",audienceQuestion:"What must the visitor understand?",ctaRole:"SECONDARY",fallback:"Render the semantic fallback.",localePolicy:{sourceLocale:"en",localizationReady:true},fields:[duplicate,structuredClone(duplicate)],quality:{forbiddenPhraseHits:[],repeatedPublishableValues:[]}};
  const {signature:_,...unsigned}=graph;
  graph.signature=completePageGraphSignature(unsigned);
  const errors=validateCompletePageGraph(graph);
  assert.ok(errors.includes(`${node.id}.content: field slot projection drift`));
  assert.ok(errors.includes(`${node.id}.content: duplicate content field slot`));
  assert.ok(errors.includes(`${node.id}.content: section identity drift`));
  assert.ok(errors.includes(`${node.id}.content: headline lacks exact READY field backing`));
});

test("motion media responsive and semantic identities remain aligned per node",()=>{
  for(const graph of compileAllSectionPageFixtures().map(compileCompletePageGraph)){
    graph.nodes.forEach((node,index)=>{
      assert.equal(node.semanticIndex,index);
      assert.equal(node.motionHook.sectionId,node.id);
      assert.equal(node.mediaHook.sectionId,node.id);
      assert.equal(node.responsive.kind,node.kind);
      assert.equal(node.responsive.semanticOrder,"DOM_STABLE");
    });
  }
});
