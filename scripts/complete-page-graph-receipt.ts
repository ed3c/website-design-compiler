import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ARENA_CATEGORIES } from "../src/arena.js";
import type { NaturalLanguageBriefInput } from "../src/brief-normalizer.js";
import { validateCompletePageGraph } from "../src/complete-page-graph.js";
import { compileCompleteSiteGraph, validateCompleteSiteGraph } from "../src/complete-site-graph.js";
import {
  applyProductionContentPatch,
  createProductionContentPatch,
  productionContentFieldDigest
} from "../src/compiler-kernel/production-content-patch.js";
import { assertLosslessSiteGraphRoundTrip, pageGraphFingerprint } from "../src/page-graph-roundtrip.js";
import { compileProductionSite } from "../src/production-site-compiler.js";
import { canonicalJsonSha256, createByteSourceManifest, type ParserIdentity } from "../src/source-plane/manifest.js";
import { createSourceObservation } from "../src/source-plane/observations.js";
import { validateAgainstSchema } from "../src/validate.js";

function exactHeadSha():string{
  const headRef=process.env.GITHUB_HEAD_REF?.trim();
  const value=(headRef
    ? execFileSync("git",["rev-parse",`refs/remotes/origin/${headRef}`],{encoding:"utf8"})
    : execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"})
  ).trim().toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(value))throw new Error("browser proof canonical head must be an exact 40-character Git SHA");
  return value;
}

const incompleteInputs=JSON.parse(await readFile(resolve("fixtures/v2/brief-benchmarks.json"),"utf8")) as NaturalLanguageBriefInput[];
const qualityInputs=JSON.parse(await readFile(resolve("fixtures/v2/quality-site-benchmarks.json"),"utf8")) as NaturalLanguageBriefInput[];
const incompleteCompilations=incompleteInputs.map(compileProductionSite);
const compilations=qualityInputs.map(compileProductionSite);const errors:string[]=[];
const expectedCategories=ARENA_CATEGORIES;
const incompleteProjects=incompleteInputs.map((input)=>input.project).sort();
const qualityProjects=qualityInputs.map((input)=>input.project).sort();
const cohortIdentityMatches=incompleteInputs.length===6&&qualityInputs.length===6&&JSON.stringify(incompleteProjects)===JSON.stringify(qualityProjects);
if(!cohortIdentityMatches)errors.push("expected two corresponding six-project benchmark cohorts");
const failClosedInputs=incompleteCompilations.every((compilation)=>compilation.siteGraph.readiness==="NEEDS_INPUT"&&compilation.siteGraph.missingEvidence.length>0);
if(!failClosedInputs)errors.push("incomplete natural-language benchmarks did not remain fail-closed");
for(const compilation of compilations){
  errors.push(...validateCompleteSiteGraph(compilation.siteGraph).map((error)=>`${compilation.compilerInput.project}: ${error}`));
  await validateAgainstSchema(compilation.siteGraph,"site-graph-v2.schema.json");
  for(const entry of compilation.siteGraph.routes){errors.push(...validateCompletePageGraph(entry.page).map((error)=>`${compilation.compilerInput.project}${entry.route}: ${error}`));await validateAgainstSchema(entry.page,"page-graph-v2.schema.json");}
}
const sites=compilations.map((entry)=>entry.siteGraph);const pages=sites.flatMap((site)=>site.routes.map((entry)=>entry.page));
if(sites.some((site)=>site.readiness!=="READY"||site.missingEvidence.length>0))errors.push("one or more evidence-complete quality sites are not READY");
const observedCategories=[...new Set(sites.map((site)=>site.routes[0]?.page.category).filter((category):category is string=>Boolean(category)))].sort();
const incompleteCategories=[...new Set(incompleteCompilations.map((compilation)=>compilation.siteGraph.routes[0]?.page.category).filter((category):category is string=>Boolean(category)))].sort();
const categoryCoverage=JSON.stringify(observedCategories)===JSON.stringify([...expectedCategories].sort())&&JSON.stringify(incompleteCategories)===JSON.stringify([...expectedCategories].sort());
if(!categoryCoverage)errors.push(`expected exact six-category coverage, got ${observedCategories.join(",")||"none"}`);
const uniqueSignatures=new Set(sites.map((site)=>site.signature)).size;if(uniqueSignatures!==sites.length)errors.push(`expected ${sites.length} distinct site signatures, got ${uniqueSignatures}`);
const productionBound=pages.every((page)=>page.source.mode==="PRODUCTION"&&Object.keys(page.source.artifacts).length===7);if(!productionBound)errors.push("one or more page graphs lack exact production upstream binding");
const designSystems=Object.fromEntries(compilations.map((compilation)=>[compilation.siteGraph.routes[0]!.page.category,compilation.designSystem]));
const exactJsonSha256=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
if(compilations.some((compilation)=>exactJsonSha256(compilation.designSystem)!==compilation.siteGraph.routes[0]!.page.source.artifacts.designSystem))errors.push("one or more projected design systems drifted from the production page graph source binding");
const receipt={schema:"website-design-compiler/page-graph-receipt/v2",overall:errors.length===0?"PASS":"FAIL",siteCount:sites.length,routeCount:pages.length,uniqueSignatures,productionBound,cohortIdentityMatches,categoryCoverage,failClosedInputCount:incompleteCompilations.length,failClosedInputs,sites:sites.map((site)=>({project:site.project,readiness:site.readiness,routes:site.routes.map((entry)=>entry.route),missingEvidenceCount:site.missingEvidence.length,signature:site.signature,source:site.source})),errors};
await mkdir(resolve("artifacts/v2"),{recursive:true});await writeFile(resolve("artifacts/v2/complete-page-graph-receipt.json"),JSON.stringify(receipt,null,2)+"\n","utf8");
const graphs=Object.fromEntries(sites.map((site)=>[site.routes[0]!.page.category,site.routes[0]!.page]));
const designTokens=Object.fromEntries(compilations.map((compilation)=>[compilation.siteGraph.routes[0]!.page.category,compilation.semanticDesignTokens]));

// Produce one exact edited production subject for #146. This is intentionally generated
// through the source-plane observation and production content patch runtime rather than by
// mutating the JSON projection or authoring surface directly.
const proofCompilation=compilations.find((entry)=>entry.siteGraph.routes[0]?.page.category==="b2b-product");
if(!proofCompilation)throw new Error("kernel browser proof requires the b2b-product benchmark");
const proofBaseSite=proofCompilation.siteGraph;
const proofRoute=proofBaseSite.routes.find((entry)=>entry.route==="/");
if(!proofRoute)throw new Error("kernel browser proof requires a root production route");
const proofHero=proofRoute.page.nodes.find((node)=>node.kind==="hero");
const proofContentField=proofHero?.contentContract?.fields.find((field)=>field.slot==="headline");
if(!proofHero||!proofContentField)throw new Error("kernel browser proof requires a production hero headline content slot");
const proofHeadline="Browser-bound edit from an exact source observation";
const proofBytes=new TextEncoder().encode(proofHeadline);
const proofParserConfig={schema:"website-design-compiler/kernel-browser-proof-parser/v1",encoding:"utf-8",selection:"single-line-synthetic-public-observation"} as const;
const proofParser:ParserIdentity={name:"kernel-browser-proof-source",version:"1",configSha256:canonicalJsonSha256(proofParserConfig)};
const proofManifest=createByteSourceManifest({
  sourceId:"kernel-browser-proof-source",
  sourceClass:"ARTICLE",
  locator:"kernel-browser-proof-source",
  mediaType:"text/plain",
  bytes:proofBytes,
  accessClassification:"PUBLIC",
  publicationClassification:"PUBLIC_BYTES",
  parser:proofParser,
  extractionPolicySha256:canonicalJsonSha256({schema:"website-design-compiler/kernel-browser-proof-extraction/v1",parserConfigSha256:proofParser.configSha256}),
  capturedAt:"2026-08-19T00:00:00.000Z"
});
const proofObservation=createSourceObservation({
  sourceIdentitySha256:proofManifest.sourceIdentitySha256,
  statement:proofHeadline,
  anchors:[{kind:"LINES",startLine:1,endLine:1}],
  evidenceBytes:proofBytes,
  parser:proofParser
});
const proofPatch=createProductionContentPatch({
  patchId:"kernel-browser-proof-edit",
  expectedBaseDigest:pageGraphFingerprint(proofRoute.page),
  actor:{kind:"AGENT",id:"kernel-browser-proof-producer"},
  evidenceSha256:[proofObservation.observationIdentitySha256],
  operations:[{
    operationId:"set-browser-proof-headline",
    op:"SET_CONTENT_SLOT",
    nodeId:proofHero.id,
    expectedNodeKind:proofHero.kind,
    field:"headline",
    slot:"headline",
    expectedContentFieldSha256:productionContentFieldDigest(proofContentField),
    value:proofHeadline,
    sourceType:"observed_fact",
    sourceObservationSha256:proofObservation.observationIdentitySha256
  }]
});
const proofApplication=applyProductionContentPatch(proofRoute.page,proofPatch);
if(proofApplication.receipt.state!=="APPLIED"||!proofApplication.graph)throw new Error(`kernel browser proof patch did not apply: ${proofApplication.receipt.diagnostics.join("; ")}`);
await validateAgainstSchema(proofPatch,"production-content-patch.schema.json");
await validateAgainstSchema(proofApplication.receipt,"production-content-patch-receipt.schema.json");
const proofEditedSite=compileCompleteSiteGraph(proofBaseSite.project,proofBaseSite.routes.map((entry)=>({route:entry.route,page:entry.route==="/"?proofApplication.graph!:entry.page})));
const proofSiteErrors=validateCompleteSiteGraph(proofEditedSite);if(proofSiteErrors.length>0)throw new Error(`kernel browser proof site invalid: ${proofSiteErrors.join("; ")}`);
assertLosslessSiteGraphRoundTrip(proofEditedSite);
const subjectHeadSha=exactHeadSha();
const kernelEditProof={
  schema:"website-design-compiler/kernel-edited-page-browser-subject/v1",
  subjectHeadSha,
  category:"b2b-product",
  route:"/",
  sourceManifestIdentitySha256:proofManifest.sourceIdentitySha256,
  sourceObservationIdentitySha256:proofObservation.observationIdentitySha256,
  basePageDigest:pageGraphFingerprint(proofRoute.page),
  patchIdentitySha256:proofPatch.patchIdentitySha256,
  patchReceiptIdentitySha256:proofApplication.receipt.receiptIdentitySha256,
  resultPageDigest:pageGraphFingerprint(proofApplication.graph),
  editedHeadline:proofHeadline,
  site:proofEditedSite
};
if(kernelEditProof.resultPageDigest!==proofApplication.receipt.resultDigest)throw new Error("kernel browser proof result digest drift");

const projection={schema:"website-design-compiler/site-page-graph-projection/v2",source:"production-site-compiler",sites:Object.fromEntries(sites.map((site)=>[site.routes[0]!.page.category,site])),graphs,designTokens,designSystems,kernelEditProof};
await mkdir(resolve("apps/site/generated"),{recursive:true});await writeFile(resolve("apps/site/generated/benchmark-page-graphs.json"),JSON.stringify(projection,null,2)+"\n","utf8");
await mkdir(resolve("artifacts/browser-qa"),{recursive:true});await writeFile(resolve("artifacts/browser-qa/kernel-edit-subject.json"),JSON.stringify(kernelEditProof,null,2)+"\n","utf8");
console.log(JSON.stringify({overall:receipt.overall,siteCount:receipt.siteCount,routeCount:receipt.routeCount,uniqueSignatures,siteProjection:"apps/site/generated/benchmark-page-graphs.json",kernelEditSubject:{subjectHeadSha,patchIdentitySha256:kernelEditProof.patchIdentitySha256,resultPageDigest:kernelEditProof.resultPageDigest}}));if(receipt.overall!=="PASS")process.exitCode=1;
