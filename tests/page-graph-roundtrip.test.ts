import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { assertLosslessPageGraphRoundTrip, pageGraphFingerprint, pageGraphToPuck, puckToPageGraph, puckToPayload, payloadToPuck } from "../src/page-graph-roundtrip.js";

test("all six generated page graphs round-trip through Puck and Payload without semantic drift",()=>{
  for(const page of compileAllSectionPageFixtures()){
    const graph=compileCompletePageGraph(page);
    const source=pageGraphFingerprint(graph);
    const fingerprints=assertLosslessPageGraphRoundTrip(graph);
    assert.equal(fingerprints.puck,source);
    assert.equal(fingerprints.payload,source);
  }
});

test("Puck and Payload projections preserve semantic order and full node contracts",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const puck=pageGraphToPuck(graph);
  const payload=puckToPayload(puck);
  const restored=puckToPageGraph(payloadToPuck(payload));
  assert.deepEqual(restored.semanticOrder,graph.semanticOrder);
  assert.deepEqual(restored.nodes,graph.nodes);
  assert.deepEqual(restored.sharedChrome,graph.sharedChrome);
  assert.equal(restored.signature,graph.signature);
});

test("unsupported Puck block fails closed",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const puck=pageGraphToPuck(graph);
  (puck.content[0] as {type:string}).type="RawHtml";
  assert.throws(()=>puckToPageGraph(puck),/unsupported Puck page block/);
});
