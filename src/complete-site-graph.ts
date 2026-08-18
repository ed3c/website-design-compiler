import type { CompletePageGraph } from "./complete-page-graph.js";

export interface CompleteSiteRoute { route:string; page:CompletePageGraph; }
export interface CompleteSiteGraph {
  schema:"website-design-compiler/site-graph/v2";
  project:string;
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
export function compileCompleteSiteGraph(project:string,entries:Array<{route:string;page:CompletePageGraph}>):CompleteSiteGraph{
  if(entries.length===0)throw new Error("site graph requires at least one route");
  const routes=entries.map((entry)=>({route:normalizeRoute(entry.route),page:structuredClone(entry.page)}));
  const unique=new Set(routes.map((entry)=>entry.route));
  if(unique.size!==routes.length)throw new Error("site graph contains duplicate routes");
  const chromeKeys=new Set(routes.map((entry)=>entry.page.sharedChrome.consistencyKey));
  if(chromeKeys.size!==1)throw new Error("site graph shared navigation/footer contract drift");
  const consistencyKey=routes[0]!.page.sharedChrome.consistencyKey;
  return{schema:"website-design-compiler/site-graph/v2",project,routes,sharedChrome:{consistencyKey,navigationKind:"navigation",footerKind:"footer"},contracts:{uniqueRoutes:true,sharedChromeRequired:true,pageGraphSchema:"website-design-compiler/page-graph/v2"},signature:routes.map((entry)=>`${entry.route}:${entry.page.signature}`).join("||")};
}
export function validateCompleteSiteGraph(site:CompleteSiteGraph):string[]{
  const errors:string[]=[];
  if(site.routes.length===0)errors.push("site has no routes");
  if(new Set(site.routes.map((entry)=>entry.route)).size!==site.routes.length)errors.push("duplicate routes");
  if(site.routes.some((entry)=>!entry.route.startsWith("/")))errors.push("non-absolute governed route");
  if(site.routes.some((entry)=>entry.page.schema!==site.contracts.pageGraphSchema))errors.push("page graph schema drift");
  if(site.routes.some((entry)=>entry.page.sharedChrome.consistencyKey!==site.sharedChrome.consistencyKey))errors.push("shared chrome consistency drift");
  return errors;
}
