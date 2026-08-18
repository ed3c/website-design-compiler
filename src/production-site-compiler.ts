import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeBrief, type BriefNormalizationReceipt, type NaturalLanguageBriefInput } from "./brief-normalizer.js";
import type { CompilerInput } from "./contracts.js";
import { compileInformationArchitecture, type InformationArchitecturePlan } from "./information-architecture.js";
import { compileContentArchitecture, type ContentArchitecturePlan, type SectionContentContract } from "./content-architecture.js";
import { searchVisualDirections, visualDirectionSha256, type VisualDirectionSearchReceipt } from "./visual-direction-search.js";
import { compileSemanticDesignTokens, projectSemanticTokensToCss, type SemanticDesignTokensV2 } from "./semantic-design-tokens.js";
import { buildDesignSystemPlan, type DesignSystemPlan } from "./design-system-compiler.js";
import { buildPageArchitecturePlan, type PageArchitecturePlan } from "./page-architect.js";
import { SECTION_CONTRACTS, type SectionFieldContract, type SectionInstance } from "./section-grammar.js";
import { FIELD_SLOTS, SECTION_TYPE_TO_KIND } from "./section-content-projection.js";
import { selectSectionVariant } from "./section-presentation.js";
import type { VisualDirectionDimensions } from "./visual-direction-search.js";
import { compileCompletePageGraph, validateCompletePageGraph, type CompletePageGraph, type PageGraphSourceBinding } from "./complete-page-graph.js";
import { compileCompleteSiteGraph, validateCompleteSiteGraph, type CompleteSiteGraph } from "./complete-site-graph.js";
import { assertLosslessSiteGraphRoundTrip, payloadSiteToPuck, puckSiteToPayload, puckToSiteGraph, siteGraphFingerprint, siteGraphToPuck, type PayloadSiteGraphDocument, type PuckSiteGraphDocument } from "./page-graph-roundtrip.js";
import { validateAuthoringData } from "./puck-authoring.js";
import { validateAgainstSchema } from "./validate.js";

export interface ProductionSiteCompilation{
  schema:"website-design-compiler/production-site-compilation/v2";
  normalization:BriefNormalizationReceipt;
  compilerInput:CompilerInput;
  informationArchitecture:InformationArchitecturePlan;
  contentArchitecture:ContentArchitecturePlan;
  visualDirectionSearch:VisualDirectionSearchReceipt;
  semanticDesignTokens:SemanticDesignTokensV2;
  designSystem:DesignSystemPlan;
  pageArchitecture:PageArchitecturePlan;
  siteGraph:CompleteSiteGraph;
  puckSiteGraph:PuckSiteGraphDocument;
  payloadSiteGraph:PayloadSiteGraphDocument;
}

function categoryFor(family:string):string{return family==="motion-heavy-creative"?"motion-heavy":family;}
function toFieldValue(field:SectionFieldContract,value:string|string[],route:string):unknown{
  if(field.type==="link")return typeof value==="string"?{label:value,href:route==="/"?"#primary-action":route}:null;
  if(field.type==="items")return Array.isArray(value)?value:[value];
  if(field.type==="number")return typeof value==="string"?Number(value):null;
  if(field.type==="media")return null;
  return typeof value==="string"?value:null;
}
function fieldFor(contract:SectionContentContract,slots:readonly string[]):SectionContentContract["fields"][number]|undefined{return slots.map((slot)=>contract.fields.find((field)=>field.slot===slot)).find(Boolean);}
function projectSection(sectionId:string,sectionType:string,content:SectionContentContract,route:string,ia:InformationArchitecturePlan,iaSha256:string,direction:VisualDirectionDimensions):SectionInstance{
  const kind=SECTION_TYPE_TO_KIND[sectionType];
  if(!kind)throw new Error(`${sectionId}: no governed section kind for IA type ${sectionType}`);
  const canonical=SECTION_CONTRACTS[kind];
  const props:Record<string,unknown>={};const provenance:Record<string,string>={};
  for(const [name,fieldContract] of Object.entries(canonical.fields)){
    if((kind==="navigation"||kind==="footer")&&name==="links"){
      props[name]=ia.routes.map((entry)=>`${entry.label}:${entry.route}`);provenance[name]=`information-architecture:${iaSha256}#routes`;continue;
    }
    const field=fieldFor(content,FIELD_SLOTS[kind]?.[name]??[]);
    if(field?.state==="READY"&&field.publishable&&field.value&&field.provenance.length>0){
      const value=toFieldValue(fieldContract,field.value,route);if(value!==null){props[name]=value;provenance[name]=field.provenance.join("|");}
    }
  }
  return{id:sectionId,kind,variant:selectSectionVariant(kind,sectionType,direction),props,provenance,tokenRef:"semantic-design-tokens/v2"};
}

export function compileProductionSite(input:NaturalLanguageBriefInput):ProductionSiteCompilation{
  const normalization=normalizeBrief(input);
  if(normalization.state!=="READY"||!normalization.compilerInput)throw new Error(`brief is not compiler-ready: ${normalization.needsInput.join(", ")}`);
  const compilerInput=normalization.compilerInput;
  const informationArchitecture=compileInformationArchitecture(compilerInput);
  const contentArchitecture=compileContentArchitecture(compilerInput);
  const visualDirectionSearch=searchVisualDirections(compilerInput);
  const semanticDesignTokens=compileSemanticDesignTokens(compilerInput,visualDirectionSearch);
  const designSystem=buildDesignSystemPlan(compilerInput,visualDirectionSearch);
  const pageArchitecture=buildPageArchitecturePlan(compilerInput);
  const artifacts={
    compilerInput:visualDirectionSha256(compilerInput),informationArchitecture:visualDirectionSha256(informationArchitecture),contentArchitecture:visualDirectionSha256(contentArchitecture),
    visualDirectionSearch:visualDirectionSha256(visualDirectionSearch),semanticDesignTokens:visualDirectionSha256(semanticDesignTokens),designSystem:visualDirectionSha256(designSystem),pageArchitecture:visualDirectionSha256(pageArchitecture)
  };
  const source:PageGraphSourceBinding={mode:"PRODUCTION",artifacts};
  const contentById=new Map(contentArchitecture.sections.map((section)=>[section.sectionId,section]));
  const pages=informationArchitecture.routes.map((route):CompletePageGraph=>{
    const iaSections=route.sectionIds.map((id)=>informationArchitecture.sections.find((section)=>section.id===id)??(()=>{throw new Error(`${route.route}: unknown IA section ${id}`);})());
    const contentContracts=iaSections.map((section)=>contentById.get(section.id)??(()=>{throw new Error(`${route.route}: content contract absent for ${section.id}`);})());
    const sections=iaSections.map((section,index)=>projectSection(`${String(index+1).padStart(2,"0")}-${section.id}`,section.type,contentById.get(section.id)!,route.route,informationArchitecture,artifacts.informationArchitecture,visualDirectionSearch.selectedDirection));
    const routedContracts=contentContracts.map((contract,index)=>({...structuredClone(contract),sectionId:sections[index]!.id}));
    const page=compileCompletePageGraph({project:compilerInput.project,category:categoryFor(informationArchitecture.family),route:route.route,sections,source,contentContracts:routedContracts,visualDirection:visualDirectionSearch.selectedDirection});
    const errors=validateCompletePageGraph(page);if(errors.length>0)throw new Error(`${route.route}: invalid production page graph: ${errors.join("; ")}`);
    return page;
  });
  const siteGraph=compileCompleteSiteGraph(compilerInput.project,pages.map((page)=>({route:page.route,page})));
  const siteErrors=validateCompleteSiteGraph(siteGraph);if(siteErrors.length>0)throw new Error(`invalid production site graph: ${siteErrors.join("; ")}`);
  assertLosslessSiteGraphRoundTrip(siteGraph);
  const puckSiteGraph=siteGraphToPuck(siteGraph);for(const entry of puckSiteGraph.routes){const validation=validateAuthoringData(entry.page);if(validation.overall!=="PASS")throw new Error(`${entry.route}: Puck projection invalid: ${validation.errors.join("; ")}`);}
  const payloadSiteGraph=puckSiteToPayload(puckSiteGraph);
  if(JSON.stringify(payloadSiteToPuck(payloadSiteGraph))!==JSON.stringify(puckSiteGraph))throw new Error("Payload site projection drift");
  return{schema:"website-design-compiler/production-site-compilation/v2",normalization,compilerInput,informationArchitecture,contentArchitecture,visualDirectionSearch,semanticDesignTokens,designSystem,pageArchitecture,siteGraph,puckSiteGraph,payloadSiteGraph};
}

async function writeExactJson(path:string,value:unknown):Promise<{path:string;sha256:string}>{const bytes=JSON.stringify(value);await writeFile(path,bytes,"utf8");const readback=await readFile(path,"utf8");const sha256=visualDirectionSha256(value);if(readback!==bytes||visualDirectionSha256(JSON.parse(readback))!==sha256)throw new Error(`${path}: artifact readback identity drift`);return{path,sha256};}
async function writeExactText(path:string,value:string):Promise<{path:string;sha256:string}>{await writeFile(path,value,"utf8");const readback=await readFile(path,"utf8");const sha256=createHash("sha256").update(value).digest("hex");if(readback!==value||createHash("sha256").update(readback).digest("hex")!==sha256)throw new Error(`${path}: artifact readback identity drift`);return{path,sha256};}
export async function writeProductionSiteCompilation(compilation:ProductionSiteCompilation,outputDirectory:string):Promise<string>{
  await validateAgainstSchema(compilation.normalization,"brief-normalization-v2.schema.json");await validateAgainstSchema(compilation.compilerInput,"compiler-input.schema.json");await validateAgainstSchema(compilation.informationArchitecture,"information-architecture-v2.schema.json");await validateAgainstSchema(compilation.contentArchitecture,"content-architecture-v2.schema.json");await validateAgainstSchema(compilation.visualDirectionSearch,"visual-direction-search-v2.schema.json");await validateAgainstSchema(compilation.semanticDesignTokens,"semantic-design-tokens-v2.schema.json");await validateAgainstSchema(compilation.designSystem,"design-system-plan.schema.json");await validateAgainstSchema(compilation.pageArchitecture,"page-architecture-plan.schema.json");
  for(const entry of compilation.siteGraph.routes)await validateAgainstSchema(entry.page,"page-graph-v2.schema.json");await validateAgainstSchema(compilation.siteGraph,"site-graph-v2.schema.json");
  const expectedPuck=siteGraphToPuck(compilation.siteGraph);if(JSON.stringify(compilation.puckSiteGraph)!==JSON.stringify(expectedPuck))throw new Error("Puck site projection drift before write");
  for(const entry of compilation.puckSiteGraph.routes){const validation=validateAuthoringData(entry.page);if(validation.overall!=="PASS")throw new Error(`${entry.route}: Puck projection invalid before write: ${validation.errors.join("; ")}`);}
  const expectedPayload=puckSiteToPayload(compilation.puckSiteGraph);if(JSON.stringify(compilation.payloadSiteGraph)!==JSON.stringify(expectedPayload))throw new Error("Payload site projection drift before write");
  const sourceFingerprint=siteGraphFingerprint(compilation.siteGraph);const roundTrip={puck:siteGraphFingerprint(puckToSiteGraph(compilation.puckSiteGraph)),payload:siteGraphFingerprint(puckToSiteGraph(payloadSiteToPuck(compilation.payloadSiteGraph)))};
  if(roundTrip.puck!==sourceFingerprint||roundTrip.payload!==sourceFingerprint)throw new Error("site projection fingerprint drift before write");
  const directory=join(outputDirectory,"production-site");await mkdir(directory,{recursive:true});
  const values:Array<[string,unknown]>= [["brief-normalization.json",compilation.normalization],["compiler-input.json",compilation.compilerInput],["information-architecture.json",compilation.informationArchitecture],["content-architecture.json",compilation.contentArchitecture],["visual-direction-search.json",compilation.visualDirectionSearch],["semantic-design-tokens.json",compilation.semanticDesignTokens],["design-system.json",compilation.designSystem],["page-architecture.json",compilation.pageArchitecture],["site-graph.json",compilation.siteGraph],["puck-site-graph.json",compilation.puckSiteGraph],["payload-site-graph.json",compilation.payloadSiteGraph]];
  const artifacts=[];for(const [name,value] of values)artifacts.push(await writeExactJson(join(directory,name),value));artifacts.push(await writeExactText(join(directory,"semantic-design-tokens.css"),projectSemanticTokensToCss(compilation.semanticDesignTokens)));
  const receipt={schema:"website-design-compiler/production-site-runtime-receipt/v2",overall:"PASS",siteReadiness:compilation.siteGraph.readiness,missingEvidence:[...compilation.siteGraph.missingEvidence],stages:["brief-normalization","information-architecture","content-architecture","visual-direction-search","semantic-design-tokens","design-system","page-architecture","page-graph","site-graph","puck-payload-roundtrip"].map((stage)=>({stage,state:"PASS",evidenceOrigin:"writer-validation-runtime"})),source:structuredClone(compilation.siteGraph.source),routeCount:compilation.siteGraph.routes.length,roundTrip,artifacts};
  const receiptPath=join(directory,"runtime-receipt.json");await writeExactJson(receiptPath,receipt);return receiptPath;
}
