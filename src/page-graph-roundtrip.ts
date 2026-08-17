import { createHash } from "node:crypto";
import type { CompletePageGraph, CompletePageNode } from "./complete-page-graph.js";

export interface PageGraphAuthoringBlock {
  type:"GovernedPageSection";
  props:{
    id:string;
    kind:CompletePageNode["kind"];
    variant:string;
    section:CompletePageNode["section"];
    tokenRef:CompletePageNode["tokenRef"];
    responsive:CompletePageNode["responsive"];
    motionHook:CompletePageNode["motionHook"];
    mediaHook:CompletePageNode["mediaHook"];
    semanticIndex:number;
  };
}
export interface PageGraphAuthoringData {
  schema:"website-design-compiler/puck-page-graph/v2";
  content:PageGraphAuthoringBlock[];
  root:{props:{category:string;route:string;readiness:CompletePageGraph["readiness"];semanticOrder:string[];conversionPath:string[];sharedChrome:CompletePageGraph["sharedChrome"];contracts:CompletePageGraph["contracts"];signature:string;missingEvidence:string[]}};
}
export interface PayloadPageGraphBlock extends PageGraphAuthoringBlock["props"] { blockType:"governed-page-section"; }
export interface PayloadPageGraphDocument {
  schema:"website-design-compiler/payload-page-graph/v2";
  category:string;
  route:string;
  readiness:CompletePageGraph["readiness"];
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
  return{schema:"website-design-compiler/puck-page-graph/v2",content:graph.nodes.map((node)=>({type:"GovernedPageSection",props:structuredClone(node)})),root:{props:{category:graph.category,route:graph.route,readiness:graph.readiness,semanticOrder:[...graph.semanticOrder],conversionPath:[...graph.conversionPath],sharedChrome:structuredClone(graph.sharedChrome),contracts:structuredClone(graph.contracts),signature:graph.signature,missingEvidence:[...graph.missingEvidence]}}};
}
export function puckToPageGraph(data:PageGraphAuthoringData):CompletePageGraph{
  if(data.schema!=="website-design-compiler/puck-page-graph/v2")throw new Error("unsupported Puck page graph schema");
  const root=data.root.props;
  const nodes=data.content.map((entry,index)=>{if(entry.type!=="GovernedPageSection")throw new Error(`unsupported Puck page block at ${index}`);return structuredClone(entry.props);});
  return{schema:"website-design-compiler/page-graph/v2",category:root.category,route:root.route as "/",readiness:root.readiness,missingEvidence:[...root.missingEvidence],semanticOrder:[...root.semanticOrder],conversionPath:[...root.conversionPath],nodes,sharedChrome:structuredClone(root.sharedChrome),contracts:structuredClone(root.contracts),signature:root.signature};
}
export function puckToPayload(data:PageGraphAuthoringData):PayloadPageGraphDocument{
  const graph=puckToPageGraph(data);const root=data.root.props;
  return{schema:"website-design-compiler/payload-page-graph/v2",category:root.category,route:root.route,readiness:root.readiness,semanticOrder:[...root.semanticOrder],conversionPath:[...root.conversionPath],sharedChrome:structuredClone(root.sharedChrome),contracts:structuredClone(root.contracts),signature:root.signature,missingEvidence:[...root.missingEvidence],layout:graph.nodes.map((node)=>({blockType:"governed-page-section",...structuredClone(node)}))};
}
export function payloadToPuck(document:PayloadPageGraphDocument):PageGraphAuthoringData{
  if(document.schema!=="website-design-compiler/payload-page-graph/v2")throw new Error("unsupported Payload page graph schema");
  return{schema:"website-design-compiler/puck-page-graph/v2",content:document.layout.map((block,index)=>{if(block.blockType!=="governed-page-section")throw new Error(`unsupported Payload block at ${index}`);const {blockType:_,...props}=block;return{type:"GovernedPageSection",props:structuredClone(props)};}),root:{props:{category:document.category,route:document.route,readiness:document.readiness,semanticOrder:[...document.semanticOrder],conversionPath:[...document.conversionPath],sharedChrome:structuredClone(document.sharedChrome),contracts:structuredClone(document.contracts),signature:document.signature,missingEvidence:[...document.missingEvidence]}}};
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
