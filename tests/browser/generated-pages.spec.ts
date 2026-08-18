import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const categories=["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"] as const;
for(const category of categories){
  test(`${category} generated page consumes responsive and motion contracts`,async({page},testInfo)=>{
    if(testInfo.project.name==="reduced-motion-chromium")await page.emulateMedia({reducedMotion:"reduce"});
    const response=await page.goto(`/benchmarks/${category}`,{waitUntil:"networkidle"});
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator(`[data-generated-page='${category}']`)).toBeVisible();
    const nodes=page.locator("[data-page-node]");
    expect(await nodes.count()).toBeGreaterThanOrEqual(5);
    const indices=await nodes.evaluateAll((entries)=>entries.map((entry)=>Number(entry.getAttribute("data-semantic-index"))));
    expect(indices).toEqual(indices.map((_,index)=>index));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    expect(overflow).toBe(false);
    const viewport=testInfo.project.name.startsWith("mobile")?"mobile":testInfo.project.name.startsWith("tablet")?"tablet":"desktop";
    const expectedLayoutAttribute=`data-${viewport}-layout`;
    await expect(nodes.first()).toHaveAttribute("data-current-viewport",viewport);
    expect(await nodes.first().getAttribute(expectedLayoutAttribute)).toBeTruthy();
    const responsiveObservations=await nodes.evaluateAll((entries)=>entries.map((entry)=>{
      const style=getComputedStyle(entry);
      const content=entry.querySelector<HTMLElement>(".wdc-generated-node__content");
      const media=entry.querySelector<HTMLElement>(".wdc-generated-node__media");
      return{
        declaredColumns:Number(entry.getAttribute("data-active-columns")),
        renderedColumns:style.gridTemplateColumns.split(" ").filter(Boolean).length,
        declaredContentOrder:content?Number(content.style.order):0,
        renderedContentOrder:content?Number(getComputedStyle(content).order):0,
        declaredMediaOrder:media?Number(media.style.order):null,
        renderedMediaOrder:media?Number(getComputedStyle(media).order):null,
        contentBudgetState:entry.getAttribute("data-content-budget-state")
      };
    }));
    for(const observation of responsiveObservations){
      expect(observation.renderedColumns).toBe(observation.declaredColumns);
      expect(observation.renderedContentOrder).toBe(observation.declaredContentOrder);
      expect(observation.renderedMediaOrder).toBe(observation.declaredMediaOrder);
      expect(observation.contentBudgetState).toBe("PASS");
    }

    const firstEnterEffect=nodes.filter({has:page.locator("[data-governed-section]")}).filter({hasNot:page.locator("[data-motion-trigger='scroll-progress']")}).first();
    await expect(firstEnterEffect).toHaveAttribute("data-motion-runtime",/ACTIVE|SETTLED|VISIBLE_NO_MOTION/);
    if(testInfo.project.name==="reduced-motion-chromium"){
      await expect(nodes.first()).toHaveAttribute("data-reduced-motion","true");
      expect(await nodes.evaluateAll((entries)=>entries.every((entry)=>entry.getAttribute("data-motion-runtime")==="VISIBLE_NO_MOTION"))).toBe(true);
    }else{
      expect(await page.evaluate(()=>{
        const metrics=(window as typeof window&{__wdcGeneratedMotion?:{peak:number;layoutPropertiesAnimated:boolean}}).__wdcGeneratedMotion;
        return Boolean(metrics&&metrics.peak>0&&metrics.peak<=3&&!metrics.layoutPropertiesAnimated);
      })).toBe(true);
    }
    await page.evaluate(()=>window.dispatchEvent(new Event("wdc:generated-motion:route-change")));
    await expect(nodes.first()).toHaveAttribute("data-motion-cleanup-observed","true");
    await expect(nodes.first()).toHaveAttribute("data-motion-runtime","CLEANED");
    if(!testInfo.project.name.startsWith("reduced-motion")){
      const directory=join(process.cwd(),"artifacts","generated-pages","screenshots");
      await mkdir(directory,{recursive:true});
      await page.screenshot({path:join(directory,`${testInfo.project.name}--${category}.png`),fullPage:true});
    }
  });
}
