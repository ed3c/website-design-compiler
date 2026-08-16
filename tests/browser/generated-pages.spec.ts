import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const categories=["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"] as const;
for(const category of categories){
  test(`${category} generated page preserves semantic order and responsive containment`,async({page},testInfo)=>{
    const response=await page.goto(`/benchmarks/${category}`,{waitUntil:"networkidle"});
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator(`[data-generated-page='${category}']`)).toBeVisible();
    const nodes=page.locator("[data-page-node]");
    expect(await nodes.count()).toBeGreaterThanOrEqual(5);
    const indices=await nodes.evaluateAll((entries)=>entries.map((entry)=>Number(entry.getAttribute("data-semantic-index"))));
    expect(indices).toEqual(indices.map((_,index)=>index));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    expect(overflow).toBe(false);
    const expectedLayoutAttribute=testInfo.project.name.startsWith("mobile")?"data-mobile-layout":testInfo.project.name.startsWith("tablet")?"data-tablet-layout":"data-desktop-layout";
    expect(await nodes.first().getAttribute(expectedLayoutAttribute)).toBeTruthy();
    if(!testInfo.project.name.startsWith("reduced-motion")){
      const directory=join(process.cwd(),"artifacts","generated-pages","screenshots");
      await mkdir(directory,{recursive:true});
      await page.screenshot({path:join(directory,`${testInfo.project.name}--${category}.png`),fullPage:true});
    }
  });
}
