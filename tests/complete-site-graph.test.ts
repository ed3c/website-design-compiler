import test from "node:test";
import assert from "node:assert/strict";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompleteSiteGraph, validateCompleteSiteGraph } from "../src/complete-site-graph.js";

test("multi-route site graph preserves shared navigation and footer consistency",()=>{
  const page=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const site=compileCompleteSiteGraph("b2b-multi-route",[{route:"/",page},{route:"/pricing",page},{route:"/docs",page}]);
  assert.deepEqual(validateCompleteSiteGraph(site),[]);
  assert.deepEqual(site.routes.map((entry)=>entry.route),["/","/pricing","/docs"]);
  assert.ok(site.routes.every((entry)=>entry.page.sharedChrome.consistencyKey===site.sharedChrome.consistencyKey));
  assert.equal(new Set(site.routes.map((entry)=>entry.route)).size,3);
});

test("duplicate or invalid routes fail closed",()=>{
  const page=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  assert.throws(()=>compileCompleteSiteGraph("duplicate",[{route:"/",page},{route:"/",page}]),/duplicate routes/);
  assert.throws(()=>compileCompleteSiteGraph("invalid",[{route:"pricing",page}]),/invalid governed route/);
});

test("shared chrome drift fails closed across routes",()=>{
  const page=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const drifted={...page,sharedChrome:{...page.sharedChrome,consistencyKey:"drifted"}};
  assert.throws(()=>compileCompleteSiteGraph("drift",[{route:"/",page},{route:"/other",page:drifted}]),/shared navigation\/footer contract drift/);
});
