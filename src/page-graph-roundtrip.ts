import { createHash } from "node:crypto";
import type { CompletePageGraph, CompletePageNode } from "./complete-page-graph";
import { validateCompleteSiteGraph, type CompleteSiteGraph } from "./complete-site-graph";

export type PageGraphNodeProjection = {
  id:string;
  kind:CompletePageNode["kind"];
  variant:string;
  section:CompletePageNode["section"];
  tokenRef:CompletePageNode["tokenRef"];
  responsive:CompletePageNode["responsive"];
  motionHook:CompletePageNode["motionHook"];
  mediaHook:CompletePageNode["mediaHook"];
  contentContract:CompletePageNode["contentContract"];
  semanticIndex:number;
};
export interface PageGraphAuthoringBlock {
  type:"GovernedPageSection";
  props:PageGraphNodeProjection;
}
export interface PageGraphAuthoringData {
  schema:"website-design-compiler/puck-page-graph/v2";
  content:PageGraphAuthoringBlock[];
  root:{props:{project:string;category:string;route:string;source:CompletePageGraph["source"];readiness:CompletePageGraph["readiness"];sourceMissingEvidence:string[];semanticOrder:string[];conversionPath:string[];sharedChrome:CompletePageGraph["sharedChrome"];contracts:CompletePageGraph["contracts"];signature:string;missingEvidence:string[]}};
}
export type PayloadPageGraphBlock = PageGraphNodeProjection & { blockType:"governed-page-section" };
export interface PayloadPageGraphDocument {
  schema:"website-design-compiler/payload-page-graph/v2";
  project:string;
  category:string;
  route:string;
  source:CompletePageGraph["source"];
  readiness:CompletePageGraph["readiness"];
  sourceMissingEvidence:string[];
  semanticOrder:string[];
  conversionPath:string[];
  sharedChrome:CompletePageGraph["sharedChrome"];
  contracts:CompletePageGraph["contracts"];
  signature:string;
  missingEvidence:string[];
  layout:PayloadPageGraphBlock[];
}

function canonical(value:unknown):string{
  if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;
  if(value&&typeof value==="object")return`{${Object.keys(value as Record<string,unknown>).sort().map((key)=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function pageGraphFingerprint(graph:CompletePageGraph):string{return createHash("sha256").update(canonical(graph)).digest("hex");}

export function pageGraphToPuck(graph:CompletePageGraph):PageGraphAuthoringData{
  return{schema:"website-design-compiler/puck-page-graph/v2",content:graph.nodes.map((node)=>({type:"GovernedPageSection",props:structuredClone(node)})),root:{props:{project:graph.project,category:graph.category,route:graph.route,source:structuredClone(graph.source),readiness:graph.readiness,sourceMissingEvidence:[...graph.sourceMissingEvidence],semanticOrder:[...graph.semanticOrder],conversionPath:[...graph.conversionPath],sharedChrome:structuredClone(graph.sharedChrome),contracts:structuredClone(graph.contracts),signature:graph.signature,missingEvidence:[...graph.missingEvidence]}}};
}
export function puckToPageGraph(data:PageGraphAuthoringData):CompletePageGraph{
  if(data.schema!=="website-design-compiler/puck-page-graph/v2")throw new Error("unsupported Puck page graph schema");
  const root=data.root.props;
  const nodes:CompletePageNode[]=data.content.map((entry,index)=>{if(entry.type!=="GovernedPageSection")throw new Error(`unsupported Puck page block at ${index}`);return structuredClone(entry.props);});
  return{schema:"website-design-compiler/page-graph/v2",project:root.project,category:root.category,route:root.route,source:structuredClone(root.source),readiness:root.readiness,sourceMissingEvidence:[...root.sourceMissingEvidence],missingEvidence:[...root.missingEvidence],semanticOrder:[...root.semanticOrder],conversionPath:[...root.conversionPath],nodes,sharedChrome:structuredClone(root.sharedChrome),contracts:structuredClone(root.contracts),signature:root.signature};
}
export function puckToPayload(data:PageGraphAuthoringData):PayloadPageGraphDocument{
  const graph=puckToPageGraph(data);const root=data.root.props;
  return{schema:"website-design-compiler/payload-page-graph/v2",project:root.project,category:root.category,route:root.route,source:structuredClone(root.source),readiness:root.readiness,sourceMissingEvidence:[...root.sourceMissingEvidence],semanticOrder:[...root.semanticOrder],conversionPath:[...root.conversionPath],sharedChrome:structuredClone(root.sharedChrome),contracts:structuredClone(root.contracts),signature:root.signature,missingEvidence:[...root.missingEvidence],layout:graph.nodes.map((node)=>({blockType:"governed-page-section",...structuredClone(node)}))};
}
export function payloadToPuck(document:PayloadPageGraphDocument):PageGraphAuthoringData{
  if(document.schema!=="website-design-compiler/payload-page-graph/v2")throw new Error("unsupported Payload page graph schema");
  const content:PageGraphAuthoringBlock[]=document.layout.map((block,index)=>{
    if(block.blockType!=="governed-page-section")throw new Error(`unsupported Payload block at ${index}`);
    const {blockType:_,...props}=block;
    return{type:"GovernedPageSection",props:structuredClone(props)};
  });
  return{schema:"website-design-compiler/puck-page-graph/v2",content,root:{props:{project:document.project,category:document.category,route:document.route,source:structuredClone(document.source),readiness:document.readiness,sourceMissingEvidence:[...document.sourceMissingEvidence],semanticOrder:[...document.semanticOrder],conversionPath:[...document.conversionPath],sharedChrome:structuredClone(document.sharedChrome),contracts:structuredClone(document.contracts),signature:document.signature,missingEvidence:[...document.missingEvidence]}}};
}
export function assertLosslessPageGraphRoundTrip(graph:CompletePageGraph):{puck:string;payload:string}{
  const source=pageGraphFingerprint(graph);
  const puckGraph=puckToPageGraph(pageGraphToPuck(graph));
  const payloadGraph=puckToPageGraph(payloadToPuck(puckToPayload(pageGraphToPuck(graph))));
  const puck=pageGraphFingerprint(puckGraph);const payload=pageGraphFingerprint(payloadGraph);
  if(puck!==source)throw new Error(`${graph.category}: Puck page graph semantic drift`);
  if(payload!==source)throw new Error(`${graph.category}: Payload page graph semantic drift`);
  return{puck,payload};
}

type SiteProjectionMetadata=Pick<CompleteSiteGraph,"project"|"readiness"|"missingEvidence"|"source"|"sharedChrome"|"contracts"|"signature">;
export interface PuckSiteGraphDocument extends SiteProjectionMetadata{schema:"website-design-compiler/puck-site-graph/v2";routes:Array<{route:string;page:PageGraphAuthoringData}>;}
export interface PayloadSiteGraphDocument extends SiteProjectionMetadata{schema:"website-design-compiler/payload-site-graph/v2";routes:Array<{route:string;page:PayloadPageGraphDocument}>;}

export function siteGraphFingerprint(site:CompleteSiteGraph):string{return createHash("sha256").update(canonical(site)).digest("hex");}
function projectSiteMetadata(site:CompleteSiteGraph):SiteProjectionMetadata{return{project:site.project,readiness:site.readiness,missingEvidence:[...site.missingEvidence],source:structuredClone(site.source),sharedChrome:structuredClone(site.sharedChrome),contracts:structuredClone(site.contracts),signature:site.signature};}
function cloneProjectionMetadata(document:SiteProjectionMetadata):SiteProjectionMetadata{return{project:document.project,readiness:document.readiness,missingEvidence:[...document.missingEvidence],source:structuredClone(document.source),sharedChrome:structuredClone(document.sharedChrome),contracts:structuredClone(document.contracts),signature:document.signature};}
export function siteGraphToPuck(site:CompleteSiteGraph):PuckSiteGraphDocument{return{schema:"website-design-compiler/puck-site-graph/v2",...projectSiteMetadata(site),routes:site.routes.map((entry)=>({route:entry.route,page:pageGraphToPuck(entry.page)}))};}
export function puckSiteToPayload(document:PuckSiteGraphDocument):PayloadSiteGraphDocument{
  if(document.schema!=="website-design-compiler/puck-site-graph/v2")throw new Error("unsupported Puck site graph schema");
  return{schema:"website-design-compiler/payload-site-graph/v2",...cloneProjectionMetadata(document),routes:document.routes.map((entry)=>({route:entry.route,page:puckToPayload(entry.page)}))};
}
export function payloadSiteToPuck(document:PayloadSiteGraphDocument):PuckSiteGraphDocument{
  if(document.schema!=="website-design-compiler/payload-site-graph/v2")throw new Error("unsupported Payload site graph schema");
  return{schema:"website-design-compiler/puck-site-graph/v2",...cloneProjectionMetadata(document),routes:document.routes.map((entry)=>({route:entry.route,page:payloadToPuck(entry.page)}))};
}
export function puckToSiteGraph(document:PuckSiteGraphDocument):CompleteSiteGraph{
  if(document.schema!=="website-design-compiler/puck-site-graph/v2")throw new Error("unsupported Puck site graph schema");
  const routes=document.routes.map((entry)=>({route:entry.route,page:puckToPageGraph(entry.page)}));
  if(new Set(routes.map((entry)=>entry.route)).size!==routes.length)throw new Error("Puck site graph contains duplicate routes");
  const site:CompleteSiteGraph={schema:"website-design-compiler/site-graph/v2",...cloneProjectionMetadata(document),routes};
  const errors=validateCompleteSiteGraph(site);if(errors.length>0)throw new Error(`Puck site graph invalid: ${errors.join("; ")}`);
  return site;
}
export function assertLosslessSiteGraphRoundTrip(site:CompleteSiteGraph):{puck:string;payload:string}{
  const source=siteGraphFingerprint(site);
  const puck=siteGraphFingerprint(puckToSiteGraph(siteGraphToPuck(site)));
  const payload=siteGraphFingerprint(puckToSiteGraph(payloadSiteToPuck(puckSiteToPayload(siteGraphToPuck(site)))));
  if(puck!==source)throw new Error(`${site.project}: Puck site graph semantic drift`);
  if(payload!==source)throw new Error(`${site.project}: Payload site graph semantic drift`);
  return{puck,payload};
}
