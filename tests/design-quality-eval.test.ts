import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { auditGraphOriginality, evaluateDesignQuality, graphSignatureSimilarity } from "../src/design-quality-eval.js";
import { distantVisualCorpus,qualityObservation,tokenMatchPass } from "./helpers/design-quality.js";

test("all six categories emit separate fail-closed scorecards when browser evidence is absent",()=>{
  const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
  const cards=graphs.flatMap((graph)=>[evaluateDesignQuality(graph,"mobile"),evaluateDesignQuality(graph,"desktop")]);
  assert.equal(new Set(cards.map((card)=>card.category)).size,6);
  assert.equal(cards.filter((card)=>card.viewport==="mobile").length,6);
  assert.equal(cards.filter((card)=>card.viewport==="desktop").length,6);
  assert.ok(cards.every((card)=>Object.keys(card.dimensions).length===10));
  assert.ok(cards.every((card)=>card.measurement.state==="ABSENT"&&card.overall==="FAIL"));
});

test("intentionally poor conversion graph fails premium structural threshold",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const first=graph.nodes[0]!;
  const poor={...graph,conversionPath:[],nodes:Array.from({length:6},(_,index)=>({...first,id:`poor-${index}`,kind:"graphics-3d-stage" as const,mediaHook:{...first.mediaHook,renderer:"three" as const}}))};
  const card=evaluateDesignQuality(poor,"desktop",90);
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
  const mobile=evaluateDesignQuality(graph,"mobile",78,[],[],.82,qualityObservation(graph.category,"mobile"),tokenMatchPass,[],distantVisualCorpus("mobile"));
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
  const card=evaluateDesignQuality(graph,"desktop",50,[{id:"reference-clone",signature:graph.signature}],[]);
  assert.equal(card.overall,"FAIL");
});

test("benchmark corpus structural distance is deterministic and non-identical graphs remain distinguishable",()=>{
  const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
  const similarity=graphSignatureSimilarity(graphs[0]!.signature,graphs[1]!.signature);
  assert.ok(similarity>=0&&similarity<1);
  assert.equal(similarity,graphSignatureSimilarity(graphs[0]!.signature,graphs[1]!.signature));
});

test("pixel and computed-style evidence plus runtime token match are required for premium scoring",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const missing=evaluateDesignQuality(graph,"desktop",50);
  assert.equal(missing.measurement.state,"ABSENT");
  const observed=evaluateDesignQuality(graph,"desktop",50,[],[],.82,qualityObservation(graph.category,"desktop"),tokenMatchPass,[],distantVisualCorpus("desktop"));
  assert.equal(observed.measurement.state,"PASS");
  assert.equal(observed.overall,"PASS");
  const drift=evaluateDesignQuality(graph,"desktop",50,[],[],.82,qualityObservation(graph.category,"desktop"),{state:"FAIL",matched:12,total:13,mismatches:["--wdc-color-accent"]},[],distantVisualCorpus("desktop"));
  assert.equal(drift.measurement.state,"FAIL");
  assert.equal(drift.overall,"FAIL");
});
