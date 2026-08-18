import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph, validateCompletePageGraph } from "../src/complete-page-graph.js";

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
  assert.ok(editorial.nodes.some((node)=>node.kind==="editorial-media"));
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
