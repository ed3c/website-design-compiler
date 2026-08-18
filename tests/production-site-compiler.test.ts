import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { NaturalLanguageBriefInput } from "../src/brief-normalizer.js";
import type { CompletePageGraph } from "../src/complete-page-graph.js";
import { assertLosslessSiteGraphRoundTrip, puckToSiteGraph, siteGraphFingerprint, siteGraphToPuck } from "../src/page-graph-roundtrip.js";
import { compileProductionSite, writeProductionSiteCompilation } from "../src/production-site-compiler.js";
import { validateAgainstSchema } from "../src/validate.js";
import { visualDirectionSha256 } from "../src/visual-direction-search.js";

const inputs=JSON.parse(await readFile(new URL("../fixtures/v2/brief-benchmarks.json",import.meta.url),"utf8")) as NaturalLanguageBriefInput[];
const qualityInputs=JSON.parse(await readFile(new URL("../fixtures/v2/quality-site-benchmarks.json",import.meta.url),"utf8")) as NaturalLanguageBriefInput[];

test("six briefs compile through the real upstream chain into multi-route site graphs",()=>{
  const compilations=inputs.map(compileProductionSite);
  assert.equal(compilations.length,6);
  assert.equal(new Set(compilations.map((entry)=>entry.siteGraph.signature)).size,6);
  for(const compilation of compilations){
    assert.deepEqual(compilation.compilerInput.hardConstraints,compilation.normalization.hardConstraints);
    assert.deepEqual(compilation.siteGraph.routes.map((entry)=>entry.route),compilation.informationArchitecture.routes.map((entry)=>entry.route));
    assert.ok(compilation.siteGraph.routes.length>=2);
    assert.equal(compilation.siteGraph.source.mode,"PRODUCTION");
    assert.equal(JSON.stringify(compilation.siteGraph).includes("fixture:"),false);
    assert.equal(compilation.siteGraph.readiness,"NEEDS_INPUT");
    assert.ok(compilation.siteGraph.missingEvidence.some((entry)=>entry.includes("cta-label")||entry.includes("primary-action")));
    const fingerprint=siteGraphFingerprint(compilation.siteGraph);
    assert.deepEqual(assertLosslessSiteGraphRoundTrip(compilation.siteGraph),{puck:fingerprint,payload:fingerprint});
  }
});

test("page graphs exact-bind every upstream artifact identity",()=>{
  const compilation=compileProductionSite(inputs[0]!);
  const expected={
    compilerInput:visualDirectionSha256(compilation.compilerInput),informationArchitecture:visualDirectionSha256(compilation.informationArchitecture),contentArchitecture:visualDirectionSha256(compilation.contentArchitecture),
    visualDirectionSearch:visualDirectionSha256(compilation.visualDirectionSearch),semanticDesignTokens:visualDirectionSha256(compilation.semanticDesignTokens),designSystem:visualDirectionSha256(compilation.designSystem),pageArchitecture:visualDirectionSha256(compilation.pageArchitecture)
  };
  assert.deepEqual(compilation.siteGraph.source.artifacts,expected);
  assert.ok(compilation.siteGraph.routes.every((entry)=>JSON.stringify(entry.page.source.artifacts)===JSON.stringify(expected)));
});

test("explicit user content evidence compiles six production quality sites to READY",()=>{
  const compilations=qualityInputs.map(compileProductionSite);
  assert.equal(compilations.length,6);
  assert.deepEqual([...new Set(compilations.map((compilation)=>compilation.siteGraph.routes[0]!.page.category))].sort(),["b2b-product","editorial","interactive-2d","interactive-3d","motion-heavy","premium-consumer"]);
  for(const compilation of compilations){
    assert.equal(compilation.contentArchitecture.overall,"READY");
    assert.equal(compilation.siteGraph.readiness,"READY");
    assert.deepEqual(compilation.siteGraph.missingEvidence,[]);
    assert.ok(compilation.siteGraph.routes.every((entry)=>entry.page.nodes.every((node)=>node.contentContract?.fields.filter((field)=>field.state!=="FORBIDDEN").every((field)=>field.state==="READY"&&field.publishable&&field.provenance.length>0))));
  }
});

test("content quality findings keep the production site fail-closed",()=>{
  const input=structuredClone(qualityInputs[0]!);
  input.contentEvidence!.sections.features!["feature-items"]=["Repeated proof","Repeated proof"];
  const compilation=compileProductionSite(input);
  assert.equal(compilation.contentArchitecture.overall,"NEEDS_INPUT");
  assert.equal(compilation.pageArchitecture.sectionIntents.find((section)=>section.id==="features")?.status,"NEEDS_INPUT");
  assert.equal(compilation.pageArchitecture.sectionIntents.find((section)=>section.id==="features")?.contentContract.state,"NEEDS_INPUT");
  assert.equal(compilation.siteGraph.readiness,"NEEDS_INPUT");
  assert.ok(compilation.siteGraph.missingEvidence.some((entry)=>entry.endsWith(".content.quality")));
});

test("site projections are self-contained and reject route or content drift",()=>{
  const site=compileProductionSite(inputs[0]!).siteGraph;
  const projection=siteGraphToPuck(site);
  assert.deepEqual(puckToSiteGraph(projection),site);
  const extraRoute=structuredClone(projection);extraRoute.routes.push(structuredClone(extraRoute.routes[0]!));extraRoute.routes[2]!.route="/extra";
  assert.throws(()=>puckToSiteGraph(extraRoute),/route drift|signature drift/);
  const changedContent=structuredClone(projection);changedContent.routes[0]!.page.content[0]!.props.section.props.brand="tampered";
  assert.throws(()=>puckToSiteGraph(changedContent),/signature drift/);
});

test("runtime schema rejects unknown nested page graph fields",async()=>{
  const graph=structuredClone(compileProductionSite(inputs[0]!).siteGraph.routes[0]!.page) as CompletePageGraph;
  await validateAgainstSchema(graph,"page-graph-v2.schema.json");
  (graph.nodes[0]!.responsive.mobile as unknown as Record<string,unknown>).rawCss="position:fixed";
  await assert.rejects(validateAgainstSchema(graph,"page-graph-v2.schema.json"),/must NOT have additional properties/);
});

test("writer validates and reads back every stage before emitting PASS",async()=>{
  const compilation=compileProductionSite(inputs[0]!);
  const directory=await mkdtemp(join(tmpdir(),"wdc-production-site-"));
  const receiptPath=await writeProductionSiteCompilation(compilation,directory);
  const receipt=JSON.parse(await readFile(receiptPath,"utf8")) as {overall:string;siteReadiness:string;routeCount:number;stages:Array<{state:string;evidenceOrigin:string}>;source:{artifacts:Record<string,string>}};
  assert.equal(receipt.overall,"PASS");
  assert.equal(receipt.siteReadiness,"NEEDS_INPUT");
  assert.equal(receipt.routeCount,2);
  assert.ok(receipt.stages.every((stage)=>stage.state==="PASS"&&stage.evidenceOrigin==="writer-validation-runtime"));
  assert.deepEqual(receipt.source.artifacts,compilation.siteGraph.source.artifacts);
  assert.ok((receipt as unknown as {artifacts:Array<{path:string}>}).artifacts.some((artifact)=>artifact.path.endsWith("semantic-design-tokens.css")));
});

test("writer rejects a Puck projection changed after compilation",async()=>{
  const compilation=compileProductionSite(inputs[0]!);
  compilation.puckSiteGraph.routes[0]!.page.content[0]!.props.section.props.brand="tampered";
  const directory=await mkdtemp(join(tmpdir(),"wdc-production-site-drift-"));
  await assert.rejects(writeProductionSiteCompilation(compilation,directory),/Puck site projection drift before write/);
});
