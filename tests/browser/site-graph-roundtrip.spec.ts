import { expect,test } from "@playwright/test";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";

type ProjectedPage={signature:string;source:{mode:string;artifacts:Record<string,string>};nodes:Array<{id:string}>};
type ProjectedSite={project:string;signature:string;source:{mode:string;artifacts:Record<string,string>};routes:Array<{route:string;page:ProjectedPage}>};
const projection=JSON.parse(await readFile(join(process.cwd(),"apps/site/generated/benchmark-page-graphs.json"),"utf8")) as {source:string;sites:Record<string,ProjectedSite>};

for(const [category,site] of Object.entries(projection.sites))for(const entry of site.routes){
  test(`${category} ${entry.route} browser binds the exact production site graph`,async({page},testInfo)=>{
    const response=await page.goto(`/benchmarks/${category}?route=${encodeURIComponent(entry.route)}`,{waitUntil:"networkidle"});expect(response?.ok()).toBeTruthy();
    const root=page.locator(`[data-compiled-site='${category}']`);await expect(root).toBeVisible();
    const observed={siteProject:await root.getAttribute("data-site-project"),route:await root.getAttribute("data-site-route"),siteSignature:await root.getAttribute("data-site-signature"),pageSignature:await root.getAttribute("data-page-signature"),upstreamMode:await root.getAttribute("data-upstream-mode"),upstreamArtifacts:JSON.parse(await root.getAttribute("data-upstream-artifacts")??"null") as unknown,nodeIds:await root.locator("[data-page-node]").evaluateAll((nodes)=>nodes.map((node)=>node.getAttribute("data-page-node")))};
    expect(observed.siteProject).toBe(site.project);expect(observed.route).toBe(entry.route);expect(observed.siteSignature).toBe(site.signature);expect(observed.pageSignature).toBe(entry.page.signature);expect(observed.upstreamMode).toBe("PRODUCTION");expect(observed.upstreamArtifacts).toEqual(site.source.artifacts);expect(observed.nodeIds).toEqual(entry.page.nodes.map((node)=>node.id));
    const directory=join(process.cwd(),"artifacts","site-graph-browser","evidence");await mkdir(directory,{recursive:true});const routeId=entry.route==="/"?"root":entry.route.slice(1);await writeFile(join(directory,`${testInfo.project.name}--${category}--${routeId}.json`),`${JSON.stringify({schema:"website-design-compiler/site-graph-browser-observation/v2",browserProject:testInfo.project.name,category,...observed},null,2)}\n`,`utf8`);
  });
}
