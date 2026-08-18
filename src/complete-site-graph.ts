import { createHash } from "node:crypto";
import { validateCompletePageGraph, type CompletePageGraph } from "./complete-page-graph";

export interface CompleteSiteRoute { route:string; page:CompletePageGraph; }
export interface CompleteSiteGraph {
  schema:"website-design-compiler/site-graph/v2";
  project:string;
  readiness:"READY"|"NEEDS_INPUT";
  missingEvidence:string[];
  source:CompletePageGraph["source"];
  routes:CompleteSiteRoute[];
  sharedChrome:{consistencyKey:string;navigationKind:"navigation";footerKind:"footer"};
  contracts:{uniqueRoutes:true;sharedChromeRequired:true;pageGraphSchema:"website-design-compiler/page-graph/v2"};
  signature:string;
}
function normalizeRoute(route:string):string{
  const value=route.trim();
  if(!value.startsWith("/")||value.includes("//")||value.includes("?")||value.includes("#"))throw new Error(`invalid governed route: ${route}`);
  return value.length>1&&value.endsWith("/")?value.slice(0,-1):value;
}
function canonical(value:unknown):string{
  if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;
  if(value&&typeof value==="object")return`{${Object.keys(value as Record<string,unknown>).sort().map((key)=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value:unknown):string{return createHash("sha256").update(canonical(value)).digest("hex");}
export function completeSiteGraphSignature(site:Omit<CompleteSiteGraph,"signature">):string{return sha256(site);}
export function compileCompleteSiteGraph(project:string,entries:Array<{route:string;page:CompletePageGraph}>):CompleteSiteGraph{
  if(entries.length===0)throw new Error("site graph requires at least one route");
  const routes=entries.map((entry)=>({route:normalizeRoute(entry.route),page:structuredClone(entry.page)}));
  const unique=new Set(routes.map((entry)=>entry.route));
  if(unique.size!==routes.length)throw new Error("site graph contains duplicate routes");
  for(const entry of routes){if(entry.page.route!==entry.route)throw new Error(`${entry.route}: site route drifted from page graph route`);if(entry.page.project!==project)throw new Error(`${entry.route}: page project drifted from site project`);}
  const chromeKeys=new Set(routes.map((entry)=>entry.page.sharedChrome.consistencyKey));
  if(chromeKeys.size!==1)throw new Error("site graph shared navigation/footer contract drift");
  const consistencyKey=routes[0]!.page.sharedChrome.consistencyKey;
  const source=structuredClone(routes[0]!.page.source);
  if(routes.some((entry)=>JSON.stringify(entry.page.source)!==JSON.stringify(source)))throw new Error("site graph upstream artifact identity drift");
  const missingEvidence=[...new Set(routes.flatMap((entry)=>entry.page.missingEvidence.map((item)=>`${entry.route}:${item}`)))].sort();
  const site:Omit<CompleteSiteGraph,"signature">={schema:"website-design-compiler/site-graph/v2",project,readiness:missingEvidence.length===0?"READY":"NEEDS_INPUT",missingEvidence,source,routes,sharedChrome:{consistencyKey,navigationKind:"navigation",footerKind:"footer"},contracts:{uniqueRoutes:true,sharedChromeRequired:true,pageGraphSchema:"website-design-compiler/page-graph/v2"}};
  return{...site,signature:completeSiteGraphSignature(site)};
}
export function validateCompleteSiteGraph(site:CompleteSiteGraph):string[]{
  const errors:string[]=[];
  if(site.routes.length===0)errors.push("site has no routes");
  if(new Set(site.routes.map((entry)=>entry.route)).size!==site.routes.length)errors.push("duplicate routes");
  for(const entry of site.routes)try{if(normalizeRoute(entry.route)!==entry.route)errors.push(`${entry.route}: route is not normalized`);}catch(error){errors.push(error instanceof Error?error.message:"invalid governed route");}
  if(site.routes.some((entry)=>entry.page.schema!==site.contracts.pageGraphSchema))errors.push("page graph schema drift");
  if(site.routes.some((entry)=>entry.page.route!==entry.route))errors.push("site route drifted from page graph route");
  if(site.routes.some((entry)=>entry.page.project!==site.project))errors.push("page project drifted from site project");
  for(const entry of site.routes)errors.push(...validateCompletePageGraph(entry.page).map((error)=>`${entry.route}: ${error}`));
  if(site.routes.some((entry)=>entry.page.sharedChrome.consistencyKey!==site.sharedChrome.consistencyKey))errors.push("shared chrome consistency drift");
  if(site.routes.some((entry)=>JSON.stringify(entry.page.source)!==JSON.stringify(site.source)))errors.push("site upstream artifact identity drift");
  const expectedMissing=[...new Set(site.routes.flatMap((entry)=>entry.page.missingEvidence.map((item)=>`${entry.route}:${item}`)))].sort();
  if(JSON.stringify(site.missingEvidence)!==JSON.stringify(expectedMissing))errors.push("site missing-evidence aggregation drift");
  if(site.readiness==="READY"&&site.missingEvidence.length>0)errors.push("READY site contains missing evidence");
  if(site.readiness==="NEEDS_INPUT"&&site.missingEvidence.length===0)errors.push("NEEDS_INPUT site has no named missing evidence");
  const {signature:_,...unsigned}=site;if(site.signature!==completeSiteGraphSignature(unsigned))errors.push("site graph signature drift");
  return errors;
}
