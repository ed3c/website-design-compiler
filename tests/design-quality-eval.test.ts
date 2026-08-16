import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { evaluateDesignQuality } from "../src/design-quality-eval.js";

test("every Arena category emits independent mobile and desktop quality scorecards",()=>{
  for(const graph of compileAllSectionPageFixtures().map(compileCompletePageGraph)){
    const mobile=evaluateDesignQuality(graph,"mobile",70);
    const desktop=evaluateDesignQuality(graph,"desktop",70);
    assert.equal(mobile.graphSignature,graph.signature);
    assert.equal(desktop.graphSignature,graph.signature);
    assert.equal(mobile.viewport,"mobile");
    assert.equal(desktop.viewport,"desktop");
    assert.equal(mobile.evidence.screenshot,"NOT_EXERCISED");
    assert.ok(mobile.score>=0&&mobile.score<=100);
    assert.ok(desktop.score>=0&&desktop.score<=100);
  }
});

test("functional validity alone cannot fabricate screenshot-backed premium evidence",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const card=evaluateDesignQuality(graph,"desktop");
  assert.equal(card.evidence.pageGraph,"BOUND");
  assert.equal(card.evidence.tokens,"PENDING_SCREENSHOT_BINDING");
  assert.equal(card.evidence.screenshot,"NOT_EXERCISED");
  assert.equal(card.evidence.gitSha,"UNBOUND_IN_CORE");
});

test("intentionally repetitive and over-complex graph receives explicit penalties",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures().find((page)=>page.category==="interactive-3d")!);
  const poor=structuredClone(graph);
  poor.nodes=[...poor.nodes,...poor.nodes.slice(2,6).map((node,index)=>({...node,id:`duplicate-${index}`,semanticIndex:poor.nodes.length+index}))];
  poor.conversionPath=[];
  poor.nodes.forEach((node)=>{node.mediaHook.renderer="three";});
  const card=evaluateDesignQuality(poor,"desktop",90);
  assert.equal(card.overall,"FAIL");
  assert.ok(card.penalties.includes("repetitive-section-template"));
  assert.ok(card.penalties.includes("gratuitous-gpu-complexity"));
  assert.ok(card.penalties.includes("weak-conversion-path"));
});
