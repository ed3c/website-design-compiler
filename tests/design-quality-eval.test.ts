import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { auditGraphOriginality, evaluateDesignQuality, evaluateDesignQualityV3 } from "../src/design-quality-eval.js";
import { distantVisualCorpus,qualityObservation,tokenMatchPass } from "./helpers/design-quality.js";
import { orderedTokenSimilarity, pageGraphStructureSignature } from "../src/design-quality-calibration.js";

test("all six categories emit separate fail-closed scorecards when browser evidence is absent",()=>{
  const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
  const cards=graphs.flatMap((graph)=>[evaluateDesignQuality(graph,"mobile"),evaluateDesignQuality(graph,"desktop")]);
  assert.equal(new Set(cards.map((card)=>card.category)).size,6);
  assert.equal(cards.filter((card)=>card.viewport==="mobile").length,6);
  assert.equal(cards.filter((card)=>card.viewport==="desktop").length,6);
  assert.ok(cards.every((card)=>Object.keys(card.dimensions).length===13));
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
  const similarity=orderedTokenSimilarity(pageGraphStructureSignature(graphs[0]!).split("|"),pageGraphStructureSignature(graphs[1]!).split("|"));
  assert.ok(similarity>=0&&similarity<1);
  assert.equal(similarity,orderedTokenSimilarity(pageGraphStructureSignature(graphs[0]!).split("|"),pageGraphStructureSignature(graphs[1]!).split("|")));
});

test("structural similarity is sequence-aware instead of set-only",()=>{
  assert.equal(orderedTokenSimilarity(["hero:a","features:b","cta:c"],["hero:a","features:b","cta:c"]),1);
  assert.ok(orderedTokenSimilarity(["hero:a","features:b","cta:c"],["hero:a","cta:c","features:b"])<1);
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

test("runtime measurement fails closed for an undersized CTA or unsettled motion",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const undersized=qualityObservation(graph.category,"mobile");undersized.computed.actionTargets=[{width:43,height:44,visible:true}];
  const actionCard=evaluateDesignQuality(graph,"mobile",50,[],[],.82,undersized,tokenMatchPass,[],distantVisualCorpus("mobile"));
  assert.equal(actionCard.measurement.state,"FAIL");
  assert.ok(actionCard.penalties.includes("required-cta-action-not-observed"));
  const unsettled=qualityObservation(graph.category,"mobile");unsettled.computed.motionStates[0]="RUNNING";
  const motionCard=evaluateDesignQuality(graph,"mobile",50,[],[],.82,unsettled,tokenMatchPass,[],distantVisualCorpus("mobile"));
  assert.equal(motionCard.measurement.state,"FAIL");
  assert.ok(motionCard.penalties.includes("motion-runtime-not-settled"));
});

test("v3 evaluates all twelve runtime observations with calibrated visual and ordered structural evidence",()=>{
  const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
  const cards=graphs.flatMap((graph)=>["mobile","desktop"].map((viewport)=>evaluateDesignQualityV3(graph,viewport as "mobile"|"desktop",{
    observation:qualityObservation(graph.category,viewport as "mobile"|"desktop"),
    tokenMatch:tokenMatchPass,
    structuralCorpus:graphs.filter((candidate)=>candidate.category!==graph.category).map((candidate)=>({id:candidate.category,graph:candidate})),
    visualCorpus:distantVisualCorpus(viewport as "mobile"|"desktop")
  })));
  assert.equal(cards.length,12);
  assert.ok(cards.every((card)=>card.schema==="website-design-compiler/design-quality-eval/v3"));
  assert.ok(cards.every((card)=>card.threshold===78&&card.originalityAudit.threshold===.82));
  assert.ok(cards.every((card)=>card.methods.structuralSimilarity==="ordered-page-graph/v1"&&card.methods.visualSimilarity==="calibrated-visual/v1"));
  assert.ok(cards.every((card)=>card.overall==="PASS"),JSON.stringify(cards.map(({category,viewport,score,penalties,originalityAudit})=>({category,viewport,score,penalties,reasons:originalityAudit.reasons}))));
});

test("v3 rejects identical and over-close runtime visual evidence",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const observation=qualityObservation(graph.category,"desktop");
  const identical=evaluateDesignQualityV3(graph,"desktop",{observation,tokenMatch:tokenMatchPass,visualReferences:[{id:"identical",observation:structuredClone(observation)}]});
  assert.equal(identical.originalityAudit.state,"FAIL");
  assert.equal(identical.originalityAudit.maxVisualReferenceSimilarity,1);
  const overClose=structuredClone(observation);overClose.pixels.luminanceMean+=.001;
  const near=evaluateDesignQualityV3(graph,"desktop",{observation,tokenMatch:tokenMatchPass,visualReferences:[{id:"over-close",observation:overClose}]});
  assert.equal(near.originalityAudit.state,"FAIL");
});

test("v3 rejects identical ordered graph evidence and still fails a repetitive GPU-heavy graph",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const clone=evaluateDesignQualityV3(graph,"desktop",{observation:qualityObservation(graph.category,"desktop"),tokenMatch:tokenMatchPass,structuralReferences:[{id:"clone",graph}]});
  assert.equal(clone.originalityAudit.state,"FAIL");
  assert.ok(clone.originalityAudit.reasons.some((reason)=>reason.startsWith("reference-ordered-structure-too-close:")));
  const first=graph.nodes[0]!;
  const poor={...graph,conversionPath:[],nodes:Array.from({length:6},(_,index)=>({...first,id:`poor-v3-${index}`,kind:"graphics-3d-stage" as const,mediaHook:{...first.mediaHook,renderer:"three" as const}}))};
  const poorCard=evaluateDesignQualityV3(poor,"desktop",{observation:qualityObservation(poor.category,"desktop"),tokenMatch:tokenMatchPass,visualCorpus:distantVisualCorpus("desktop")});
  assert.equal(poorCard.overall,"FAIL");
  assert.ok(poorCard.penalties.includes("repetitive-section-template"));
  assert.ok(poorCard.penalties.includes("gratuitous-gpu-complexity"));
});

test("v3 fails closed when either viewport observation is absent",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const missing=evaluateDesignQualityV3(graph,"mobile",{tokenMatch:tokenMatchPass,visualCorpus:distantVisualCorpus("mobile")});
  assert.equal(missing.measurement.state,"ABSENT");
  assert.equal(missing.overall,"FAIL");
});

test("v3 refuses callers that try to lower either governed threshold",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  assert.throws(()=>evaluateDesignQualityV3(graph,"desktop",{premiumQualityThreshold:77}),/cannot be lower than 78/);
  assert.throws(()=>evaluateDesignQualityV3(graph,"desktop",{originalitySimilarityThreshold:.81}),/cannot be lower than 0.82/);
});
