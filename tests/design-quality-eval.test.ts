import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { auditGraphOriginality, evaluateDesignQuality, graphSignatureSimilarity } from "../src/design-quality-eval.js";

const goodVisual={schema:"website-design-compiler/generated-page-visual-observation/v1" as const,category:"fixture",project:"desktop-chromium",viewport:{width:1440,height:1000},nodeCount:7,sectionKinds:["navigation","hero","feature-grid","proof-cloud","cta","footer"],typography:{families:["Inter","serif"],headingToBodyRatio:2.5,distinctHeadingSizes:3},contrast:{minimumRatio:7.2,sampleCount:24},rhythm:{averageVerticalGap:48,distinctBackgrounds:3,sectionTransitions:4},ctaCount:3,clippedTextCount:0};

test("all six categories emit separate mobile and desktop quality scorecards",()=>{
  const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
  const cards=graphs.flatMap((graph)=>[evaluateDesignQuality(graph,"mobile",78,[],[],0.82,{...goodVisual,project:"mobile-chromium",viewport:{width:390,height:844}}),evaluateDesignQuality(graph,"desktop",78,[],[],0.82,goodVisual)]);
  assert.equal(new Set(cards.map((card)=>card.category)).size,6);
  assert.equal(cards.filter((card)=>card.viewport==="mobile").length,6);
  assert.equal(cards.filter((card)=>card.viewport==="desktop").length,6);
  assert.ok(cards.every((card)=>Object.keys(card.dimensions).length===13));
});

test("intentionally poor conversion graph fails premium structural threshold",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const first=graph.nodes[0]!;
  const poor={...graph,conversionPath:[],nodes:Array.from({length:6},(_,index)=>({...first,id:`poor-${index}`,kind:"graphics-3d-stage" as const,mediaHook:{...first.mediaHook,renderer:"three" as const}}))};
  const card=evaluateDesignQuality(poor,"desktop",90,[],[],0.82,{...goodVisual,clippedTextCount:2});
  assert.equal(card.overall,"FAIL");
  assert.equal(card.intent.mode,"CONVERSION");
  assert.ok(card.penalties.includes("repetitive-section-template"));
  assert.ok(card.penalties.includes("gratuitous-gpu-complexity"));
  assert.ok(card.penalties.includes("weak-conversion-path"));
  assert.ok(card.penalties.includes("required-cta-missing"));
});

test("editorial quality evaluates information progression instead of inventing a commercial CTA requirement",()=>{
  const editorial=compileAllSectionPageFixtures().find((page)=>page.category==="editorial")!;
  const graph=compileCompletePageGraph(editorial);
  assert.equal(graph.nodes.some((node)=>node.kind==="cta"),false);
  const mobile=evaluateDesignQuality(graph,"mobile",78,[],[],0.82,{...goodVisual,project:"mobile-chromium",viewport:{width:390,height:844}});
  assert.equal(mobile.intent.mode,"INFORMATION");
  assert.equal(mobile.intent.ctaRequired,false);
  assert.equal(mobile.penalties.includes("weak-conversion-path"),false);
  assert.equal(mobile.penalties.includes("required-cta-missing"),false);
  assert.equal(mobile.overall,"PASS");
});

test("exact reference structure is rejected by design-quality originality audit",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const audit=auditGraphOriginality(graph.signature,[{id:"reference-clone",signature:graph.signature}],[]);
  assert.equal(audit.state,"FAIL");
  assert.equal(audit.maxReferenceSimilarity,1);
  assert.ok(audit.reasons.some((reason)=>reason.startsWith("reference-structure-too-close:")));
  const card=evaluateDesignQuality(graph,"desktop",50,[{id:"reference-clone",signature:graph.signature}],[],0.82,goodVisual);
  assert.equal(card.overall,"FAIL");
});

test("benchmark corpus structural distance is deterministic and non-identical graphs remain distinguishable",()=>{
  const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
  const similarity=graphSignatureSimilarity(graphs[0]!.signature,graphs[1]!.signature);
  assert.ok(similarity>=0&&similarity<1);
  assert.equal(similarity,graphSignatureSimilarity(graphs[0]!.signature,graphs[1]!.signature));
});

test("a structurally plausible graph cannot claim premium quality without browser visual observations",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const card=evaluateDesignQuality(graph,"desktop",1);
  assert.equal(card.visualEvidenceState,"NOT_EXERCISED");
  assert.equal(card.overall,"FAIL");
  assert.ok(card.penalties.includes("browser-visual-evidence-not-exercised"));
});
