import AxeBuilder from "@axe-core/playwright";
import { expect,test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateAgainstSchema } from "../../src/validate.js";

const categories=["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"] as const;

for(const category of categories)test(`${category} emits browser-derived visual quality observations`,async({page},testInfo)=>{
  const project=testInfo.project.name;
  test.skip(project!=="desktop-chromium"&&project!=="mobile-chromium","quality evaluator owns desktop and mobile evidence only");
  const viewport=project==="mobile-chromium"?"mobile":"desktop";
  const response=await page.goto(`/benchmarks/${category}`,{waitUntil:"networkidle"});
  expect(response?.ok()).toBeTruthy();
  const root=page.locator(`[data-generated-page='${category}']`);
  await expect(root).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event("wdc:generated-motion:route-change")));
  await expect(root.locator("[data-page-node]").first()).toHaveAttribute("data-motion-runtime","CLEANED");

  const outputRoot=join(process.cwd(),"artifacts","design-quality-browser");
  const screenshotDirectory=join(outputRoot,"screenshots");
  await mkdir(screenshotDirectory,{recursive:true});
  const screenshotName=`${project}--${category}.png`;
  const screenshotPath=join(screenshotDirectory,screenshotName);
  const screenshot=await page.screenshot({path:screenshotPath,fullPage:true});
  const screenshotSha256=createHash("sha256").update(screenshot).digest("hex");
  const screenshotDataUrl=`data:image/png;base64,${screenshot.toString("base64")}`;

  const pixels=await page.evaluate(async(dataUrl)=>{
    const image=new Image();
    image.src=dataUrl;
    await image.decode();
    const width=64;
    const height=Math.max(1,Math.min(128,Math.round(width*image.naturalHeight/image.naturalWidth)));
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    const context=canvas.getContext("2d",{willReadFrequently:true});
    if(!context)throw new Error("2D canvas unavailable for screenshot pixel observation");
    context.drawImage(image,0,0,width,height);
    const data=context.getImageData(0,0,width,height).data;
    const luminance:number[]=[];const red:number[]=[];const green:number[]=[];const blue:number[]=[];const colors=new Map<string,number>();let edgeTotal=0;let edgeCount=0;
    for(let y=0;y<height;y+=1)for(let x=0;x<width;x+=1){
      const offset=(y*width+x)*4;const r=data[offset]!;const g=data[offset+1]!;const b=data[offset+2]!;const alpha=data[offset+3]!;
      if(alpha===0)continue;
      const value=(0.2126*r+0.7152*g+0.0722*b)/255;luminance.push(value);red.push(r/255);green.push(g/255);blue.push(b/255);
      const key=`${r>>4}:${g>>4}:${b>>4}`;colors.set(key,(colors.get(key)??0)+1);
      if(x>0){const left=offset-4;const leftValue=(0.2126*data[left]!+0.7152*data[left+1]!+0.0722*data[left+2]!)/255;edgeTotal+=Math.abs(value-leftValue);edgeCount+=1;}
    }
    const sorted=[...luminance].sort((a,b)=>a-b);const mean=luminance.reduce((sum,value)=>sum+value,0)/Math.max(1,luminance.length);
    const variance=luminance.reduce((sum,value)=>sum+(value-mean)**2,0)/Math.max(1,luminance.length);
    const channel=(values:number[])=>{const channelMean=values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);return{mean:channelMean,stdDev:Math.sqrt(values.reduce((sum,value)=>sum+(value-channelMean)**2,0)/Math.max(1,values.length))};};
    const entropy=[...colors.values()].reduce((sum,count)=>{const probability=count/Math.max(1,luminance.length);return sum-probability*Math.log2(probability);},0);
    return{sourceWidth:image.naturalWidth,sourceHeight:image.naturalHeight,sampledPixels:luminance.length,quantizedUniqueColors:colors.size,luminanceMean:mean,luminanceStdDev:Math.sqrt(variance),luminanceSpan:(sorted[Math.floor(sorted.length*.95)]??0)-(sorted[Math.floor(sorted.length*.05)]??0),edgeContrastMean:edgeTotal/Math.max(1,edgeCount),colorEntropy:entropy,channels:{red:channel(red),green:channel(green),blue:channel(blue)}};
  },screenshotDataUrl);

  const computed=await root.evaluate((element)=>{
    const nodes=[...element.querySelectorAll<HTMLElement>("[data-page-node]")];
    const h1=[...element.querySelectorAll<HTMLElement>("h1")];const h2=[...element.querySelectorAll<HTMLElement>("h2")];
    const fontSize=(entry:HTMLElement)=>Number.parseFloat(getComputedStyle(entry).fontSize);
    const h2Sizes=h2.map(fontSize).sort((a,b)=>a-b);
    const sections=nodes.map((node)=>{const rect=node.getBoundingClientRect();return{top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,columns:Number(node.dataset.activeColumns),layout:node.dataset.activeLayout??"missing",background:getComputedStyle(node.querySelector<HTMLElement>("[data-governed-section]")??node).backgroundColor};});
    const gaps=sections.slice(1).map((section,index)=>Math.max(0,section.top-sections[index]!.bottom));
    const gapMean=gaps.reduce((sum,value)=>sum+value,0)/Math.max(1,gaps.length);
    const gapVariance=gaps.reduce((sum,value)=>sum+(value-gapMean)**2,0)/Math.max(1,gaps.length);
    const actions=[...element.querySelectorAll<HTMLElement>("[data-governed-section='cta'] a,[data-governed-section='cta'] button")];
    const actionTargets=actions.map((action)=>{const rect=action.getBoundingClientRect();return{width:rect.width,height:rect.height,visible:rect.width>0&&rect.height>0&&getComputedStyle(action).visibility!=="hidden"};});
    const styles=getComputedStyle(document.documentElement);
    const tokenNames=["--wdc-color-background","--wdc-color-surface","--wdc-color-text-primary","--wdc-color-text-muted","--wdc-color-accent","--wdc-color-on-accent","--wdc-color-focus","--wdc-font-display","--wdc-font-body","--wdc-space-sm","--wdc-space-md","--wdc-space-lg","--wdc-motion-fast","--wdc-motion-base","--wdc-container-max","--wdc-gutter"];
    return{
      viewport:{width:window.innerWidth,height:window.innerHeight},h1Count:h1.length,h2Count:h2.length,h1Px:h1[0]?fontSize(h1[0]):0,medianH2Px:h2Sizes[Math.floor(h2Sizes.length/2)]??0,
      fontFamilies:[...new Set([...h1,...h2].map((entry)=>getComputedStyle(entry).fontFamily))],sectionCount:sections.length,sectionHeights:sections.map((section)=>section.height),renderedColumns:sections.map((section)=>section.columns),layouts:sections.map((section)=>section.layout),
      distinctSectionBackgrounds:new Set(sections.map((section)=>section.background)).size,spacingGapMean:gapMean,spacingGapStdDev:Math.sqrt(gapVariance),pageWidth:element.getBoundingClientRect().width,pageHeight:element.getBoundingClientRect().height,
      overflowX:document.documentElement.scrollWidth>window.innerWidth+1,ctaSectionCount:element.querySelectorAll("[data-governed-section='cta']").length,actionTargets,
      mediaStages:element.querySelectorAll("[data-orchestrated-media]").length,motionStates:nodes.map((node)=>node.dataset.motionRuntime??"missing"),contentBudgetPass:nodes.every((node)=>node.dataset.contentBudgetState==="PASS"),
      cssTokens:Object.fromEntries(tokenNames.map((name)=>[name,styles.getPropertyValue(name).trim()]))
    };
  });
  const axe=await new AxeBuilder({page}).analyze();
  const seriousCritical=axe.violations.filter((violation)=>violation.impact==="serious"||violation.impact==="critical");
  const observation={schema:"website-design-compiler/design-quality-browser-observation/v1",category,project,viewport,git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"},screenshot:{path:`artifacts/design-quality-browser/screenshots/${screenshotName}`,sha256:screenshotSha256,bytes:screenshot.byteLength},pixels,computed,accessibility:{seriousCriticalViolationCount:seriousCritical.length,ruleIds:seriousCritical.map((violation)=>violation.id)}};
  await validateAgainstSchema(observation,"design-quality-browser-observation.schema.json");
  await writeFile(join(outputRoot,`${project}--${category}.json`),`${JSON.stringify(observation,null,2)}\n`,`utf8`);
  expect(computed.overflowX).toBe(false);
  expect(computed.h1Count).toBe(1);
  expect(pixels.sampledPixels).toBeGreaterThan(1000);
  expect(pixels.quantizedUniqueColors).toBeGreaterThan(4);
});
