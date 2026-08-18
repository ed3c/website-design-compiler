import { mkdir,readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NaturalLanguageBriefInput } from "../src/brief-normalizer.js";
import { validateCompletePageGraph } from "../src/complete-page-graph.js";
import { validateCompleteSiteGraph } from "../src/complete-site-graph.js";
import { compileProductionSite } from "../src/production-site-compiler.js";
import { validateAgainstSchema } from "../src/validate.js";

const incompleteInputs=JSON.parse(await readFile(resolve("fixtures/v2/brief-benchmarks.json"),"utf8")) as NaturalLanguageBriefInput[];
const qualityInputs=JSON.parse(await readFile(resolve("fixtures/v2/quality-site-benchmarks.json"),"utf8")) as NaturalLanguageBriefInput[];
const incompleteCompilations=incompleteInputs.map(compileProductionSite);
const compilations=qualityInputs.map(compileProductionSite);const errors:string[]=[];
const expectedCategories=["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"];
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
const receipt={schema:"website-design-compiler/page-graph-receipt/v2",overall:errors.length===0?"PASS":"FAIL",siteCount:sites.length,routeCount:pages.length,uniqueSignatures,productionBound,cohortIdentityMatches,categoryCoverage,failClosedInputCount:incompleteCompilations.length,failClosedInputs,sites:sites.map((site)=>({project:site.project,readiness:site.readiness,routes:site.routes.map((entry)=>entry.route),missingEvidenceCount:site.missingEvidence.length,signature:site.signature,source:site.source})),errors};
await mkdir(resolve("artifacts/v2"),{recursive:true});await writeFile(resolve("artifacts/v2/complete-page-graph-receipt.json"),JSON.stringify(receipt,null,2)+"\n","utf8");
const graphs=Object.fromEntries(sites.map((site)=>[site.routes[0]!.page.category,site.routes[0]!.page]));
const designTokens=Object.fromEntries(compilations.map((compilation)=>[compilation.siteGraph.routes[0]!.page.category,compilation.semanticDesignTokens]));
const projection={schema:"website-design-compiler/site-page-graph-projection/v2",source:"production-site-compiler",sites:Object.fromEntries(sites.map((site)=>[site.routes[0]!.page.category,site])),graphs,designTokens};
await mkdir(resolve("apps/site/generated"),{recursive:true});await writeFile(resolve("apps/site/generated/benchmark-page-graphs.json"),JSON.stringify(projection,null,2)+"\n","utf8");
console.log(JSON.stringify({overall:receipt.overall,siteCount:receipt.siteCount,routeCount:receipt.routeCount,uniqueSignatures,siteProjection:"apps/site/generated/benchmark-page-graphs.json"}));if(receipt.overall!=="PASS")process.exitCode=1;
