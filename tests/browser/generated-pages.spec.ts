import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ARENA_CATEGORIES } from "../../src/arena.js";

function measureGeneratedPageLayout(){
  const tolerance=1;
  const clips=(element:HTMLElement,axis:"x"|"y")=>{
    const style=getComputedStyle(element);
    const overflow=axis==="x"?style.overflowX:style.overflowY;
    const hasHiddenOverflow=overflow==="hidden"||overflow==="clip";
    const contentSize=axis==="x"?element.scrollWidth:element.scrollHeight;
    const boxSize=axis==="x"?element.clientWidth:element.clientHeight;
    return boxSize>0&&contentSize>boxSize+tolerance&&hasHiddenOverflow;
  };
  const textSelector="h1,h2,h3,h4,h5,h6,p,li,a,button,label,blockquote,figcaption";
  const textClipping=Array.from(document.querySelectorAll<HTMLElement>(`[data-page-node] ${textSelector}`)).flatMap((element)=>{
    const style=getComputedStyle(element);
    const lineClamp=Number.parseInt(style.webkitLineClamp,10);
    const clippedX=clips(element,"x");
    const clippedY=clips(element,"y")||(Number.isFinite(lineClamp)&&lineClamp>0&&element.scrollHeight>element.clientHeight+tolerance);
    return clippedX||clippedY?[{tag:element.tagName.toLowerCase(),text:(element.textContent??"").trim().slice(0,80),clippedX,clippedY,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight}]:[];
  });
  const nodeHorizontalOverflow=Array.from(document.querySelectorAll<HTMLElement>("[data-page-node]")).flatMap((element)=>element.clientWidth>0&&element.scrollWidth>element.clientWidth+tolerance?[{id:element.dataset.pageNode??"UNKNOWN",scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}]:[]);
  const unsafeHorizontalScroll=Array.from(document.querySelectorAll<HTMLElement>("[data-page-node] *")).flatMap((element)=>{
    const overflowX=getComputedStyle(element).overflowX;
    return (overflowX==="auto"||overflowX==="scroll")&&element.clientWidth>0&&element.scrollWidth>element.clientWidth+tolerance?[{tag:element.tagName.toLowerCase(),text:(element.textContent??"").trim().slice(0,80),scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}]:[];
  });
  return{documentHorizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+tolerance,textClipping,nodeHorizontalOverflow,unsafeHorizontalScroll};
}

const categories=ARENA_CATEGORIES;
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
    const runtimeLayout=await page.evaluate(measureGeneratedPageLayout);
    expect(runtimeLayout.documentHorizontalOverflow,"document has unsafe horizontal overflow").toBe(false);
    expect(runtimeLayout.nodeHorizontalOverflow,"generated section exceeds its runtime box").toEqual([]);
    expect(runtimeLayout.unsafeHorizontalScroll,"generated content requires unsafe horizontal scrolling").toEqual([]);
    expect(runtimeLayout.textClipping,"rendered text is actually clipped").toEqual([]);
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

    const asymmetric=await page.locator("[data-direction-grid='asymmetric']").count()===1;
    if(asymmetric){
      const reorderedNodes=await nodes.evaluateAll((entries)=>entries.flatMap((entry)=>{
        const content=entry.querySelector<HTMLElement>(".wdc-generated-node__content");
        const media=entry.querySelector<HTMLElement>(".wdc-generated-node__media,.wdc-generated-node__field");
        if(!content||!media||Number(getComputedStyle(media).order)>=Number(getComputedStyle(content).order))return[];
        return[{id:entry.getAttribute("data-page-node"),contentPrecedesMediaInDom:Boolean(content.compareDocumentPosition(media)&Node.DOCUMENT_POSITION_FOLLOWING)}];
      }));
      expect(reorderedNodes.length,"asymmetric page must materially reorder at least one generated node").toBeGreaterThan(0);
      expect(reorderedNodes.every((entry)=>entry.contentPrecedesMediaInDom),`semantic DOM drift: ${JSON.stringify(reorderedNodes)}`).toBe(true);

      const expectedFocusOrder=await page.evaluate(()=>{
        const selector="main a[href],main button:not([disabled]),main input:not([disabled]),main select:not([disabled]),main textarea:not([disabled]),main [tabindex]:not([tabindex='-1'])";
        const targets=Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element)=>{
          const style=getComputedStyle(element);const box=element.getBoundingClientRect();
          return element.tabIndex>=0&&style.visibility!=="hidden"&&style.display!=="none"&&box.width>0&&box.height>0;
        });
        targets.forEach((element,index)=>{element.dataset.keyboardSequence=String(index);});
        (document.activeElement as HTMLElement|null)?.blur();
        return targets.map((_,index)=>String(index));
      });
      expect(expectedFocusOrder.length,"asymmetric generated page needs a meaningful keyboard path").toBeGreaterThan(1);
      const observedFocusOrder:string[]=[];
      for(const _ of expectedFocusOrder){
        await page.keyboard.press("Tab");
        observedFocusOrder.push(await page.evaluate(()=>(document.activeElement as HTMLElement|null)?.dataset.keyboardSequence??"OUTSIDE_GENERATED_PAGE"));
      }
      expect(observedFocusOrder,"keyboard focus must follow semantic DOM order despite CSS visual reordering").toEqual(expectedFocusOrder);
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

test("runtime layout gate detects injected clipping and unsafe horizontal scrolling",async({page})=>{
  const response=await page.goto("/benchmarks/b2b-product",{waitUntil:"networkidle"});
  expect(response?.ok()).toBeTruthy();
  await page.evaluate(()=>{
    const node=document.querySelector<HTMLElement>("[data-page-node]");
    if(!node)throw new Error("negative-control generated content is absent");
    const clippedText=document.createElement("p");clippedText.textContent="runtime clipping negative control with intentionally oversized text";
    clippedText.style.cssText="display:block;width:24px;height:2px;line-height:20px;overflow:hidden;white-space:nowrap";
    node.append(clippedText);
    const scrollContainer=document.createElement("div");scrollContainer.style.width="20px";scrollContainer.style.overflowX="auto";
    const wideChild=document.createElement("div");wideChild.style.width="400px";wideChild.textContent="runtime overflow negative control";
    scrollContainer.append(wideChild);node.append(scrollContainer);
    const nodeOverflow=document.createElement("div");nodeOverflow.style.width="200vw";nodeOverflow.textContent="generated node overflow negative control";node.append(nodeOverflow);
  });
  const observation=await page.evaluate(measureGeneratedPageLayout);
  expect(observation.textClipping.length,"negative control must trip real text clipping measurement").toBeGreaterThan(0);
  expect(observation.nodeHorizontalOverflow.length,"negative control must trip generated-node overflow measurement").toBeGreaterThan(0);
  expect(observation.unsafeHorizontalScroll.length,"negative control must trip unsafe scroll-container measurement").toBeGreaterThan(0);
});
