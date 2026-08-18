import test from "node:test";
import assert from "node:assert/strict";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompleteSiteGraph, validateCompleteSiteGraph } from "../src/complete-site-graph.js";

test("multi-route site graph preserves shared navigation and footer consistency",()=>{
  const fixture=compileAllSectionPageFixtures()[0]!;
  const pages=["/","/pricing","/docs"].map((route)=>compileCompletePageGraph({...fixture,project:"b2b-multi-route",route}));
  const site=compileCompleteSiteGraph("b2b-multi-route",pages.map((page)=>({route:page.route,page})));
  assert.deepEqual(validateCompleteSiteGraph(site),[]);
  assert.deepEqual(site.routes.map((entry)=>entry.route),["/","/pricing","/docs"]);
  assert.ok(site.routes.every((entry)=>entry.page.sharedChrome.consistencyKey===site.sharedChrome.consistencyKey));
  assert.equal(new Set(site.routes.map((entry)=>entry.route)).size,3);
});

test("duplicate or invalid routes fail closed",()=>{
  const page=compileCompletePageGraph({...compileAllSectionPageFixtures()[0]!,project:"duplicate",route:"/"});
  assert.throws(()=>compileCompleteSiteGraph("duplicate",[{route:"/",page},{route:"/",page}]),/duplicate routes/);
  assert.throws(()=>compileCompleteSiteGraph("duplicate",[{route:"pricing",page}]),/invalid governed route/);
});

test("shared chrome drift fails closed across routes",()=>{
  const fixture=compileAllSectionPageFixtures()[0]!;
  const page=compileCompletePageGraph({...fixture,project:"drift",route:"/"});
  const drifted={...compileCompletePageGraph({...fixture,project:"drift",route:"/other"}),sharedChrome:{...page.sharedChrome,consistencyKey:"drifted"}};
  assert.throws(()=>compileCompleteSiteGraph("drift",[{route:"/",page},{route:"/other",page:drifted}]),/shared navigation\/footer contract drift/);
});
