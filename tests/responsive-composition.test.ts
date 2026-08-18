import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_KINDS } from "../src/section-grammar.js";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileResponsivePageGraph, compileResponsiveRegistry,compileResponsiveSectionPolicy } from "../src/responsive-composition.js";
import { searchVisualDirections } from "../src/visual-direction-search.js";

test("every governed section has explicit mobile tablet desktop and accessibility policies",()=>{
  const registry=compileResponsiveRegistry();
  assert.equal(registry.length,SECTION_KINDS.length);
  for(const policy of registry){
    assert.equal(policy.semanticOrder,"DOM_STABLE");
    assert.equal(policy.mobile.columns>=1,true);
    assert.equal(policy.tablet.columns>=1,true);
    assert.equal(policy.desktop.columns>=1,true);
    assert.equal(policy.coarsePointer.hoverRequired,false);
    assert.equal(policy.reducedMotion.essentialOnly,true);
    assert.equal(policy.degradation.maxDprMobile,1.5);
  }
});

test("responsive page graphs preserve semantic order while permitting structural composition changes",()=>{
  for(const page of compileAllSectionPageFixtures()){
    const graph=compileResponsivePageGraph(page);
    const ids=page.sections.map((section)=>section.id);
    assert.deepEqual(graph.semanticOrder,ids);
    assert.deepEqual(graph.mobile.map((entry)=>entry.id),ids);
    assert.deepEqual(graph.tablet.map((entry)=>entry.id),ids);
    assert.deepEqual(graph.desktop.map((entry)=>entry.id),ids);
  }
});

test("interactive and grid sections materially adapt between mobile and desktop",()=>{
  const registry=compileResponsiveRegistry();
  const changed=registry.filter((policy)=>JSON.stringify(policy.mobile)!==JSON.stringify(policy.desktop));
  assert.ok(changed.length>=12);
  const graphics3d=registry.find((policy)=>policy.kind==="graphics-3d-stage");
  assert.equal(graphics3d?.mobile.layout,"stage");
  assert.equal(graphics3d?.degradation.graphics3d,"static-poster");
});

test("asymmetric visual direction preserves a media-first mobile composition",()=>{
  const input={schema:"website-design-compiler/input/v1" as const,project:"responsive-3d",brief:{pageType:"interactive-3d",audience:"design teams",objective:"show a governed scene"},requestedStages:["visual-direction-search"]};
  const direction=searchVisualDirections(input).selectedDirection;
  const policy=compileResponsiveSectionPolicy("graphics-3d-stage",direction);
  assert.deepEqual(policy.mobile.visualOrder,["media","content"]);
  assert.equal(policy.mobile.mediaPlacement,"before");
});
