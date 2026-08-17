import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { evaluateDesignQuality } from "../src/design-quality-eval.js";

test("all six categories emit separate mobile and desktop quality scorecards",()=>{
  const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
  const cards=graphs.flatMap((graph)=>[evaluateDesignQuality(graph,"mobile"),evaluateDesignQuality(graph,"desktop")]);
  assert.equal(new Set(cards.map((card)=>card.category)).size,6);
  assert.equal(cards.filter((card)=>card.viewport==="mobile").length,6);
  assert.equal(cards.filter((card)=>card.viewport==="desktop").length,6);
  assert.ok(cards.every((card)=>Object.keys(card.dimensions).length===10));
});

test("intentionally poor graph fails premium structural threshold",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const first=graph.nodes[0]!;
  const poor={...graph,conversionPath:[],nodes:Array.from({length:6},(_,index)=>({...first,id:`poor-${index}`,kind:"graphics-3d-stage" as const,mediaHook:{...first.mediaHook,renderer:"three" as const}}))};
  const card=evaluateDesignQuality(poor,"desktop",90);
  assert.equal(card.overall,"FAIL");
  assert.ok(card.penalties.includes("repetitive-section-template"));
  assert.ok(card.penalties.includes("gratuitous-gpu-complexity"));
  assert.ok(card.penalties.includes("weak-conversion-path"));
});
