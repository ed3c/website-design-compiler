import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARENA_CATEGORIES } from "../../src/arena.js";
import { evaluateMediaRuntimeBudget } from "../../src/media-runtime-budget.js";
import { validateAgainstSchema } from "../../src/validate.js";
import { exactGitIdentity } from "./evidence-git.js";

const categories=ARENA_CATEGORIES;

test("generated pages execute bounded media strategies and deterministic fallbacks",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop-chromium","one browser lane owns the aggregate media runtime receipt");
  await page.setViewportSize({width:1440,height:500});
  type RuntimeGate="PASS"|"FAIL";
  type ResourceTimingObservation={state:"OBSERVED"|"UNSUPPORTED";entryCount:number;initiatorTypes:string[];transferBytes:number};
  type LazyObservation={priority:string;beforeState:string;initiallyIntersecting:boolean;afterState:string;activation:string;deferred:boolean};
  type RuntimeMetric={sectionId:string;renderer:string;state:string;budget:{maxBytes:number;maxDpr:number;maxTriangles:number;maxDrawCalls:number};observed:{transferBytes:number;textureCount:number;textureBytes:number;dpr:number;triangles:number;drawCalls:number};resourceTiming:ResourceTimingObservation;lazy:LazyObservation;gates:{resourceTiming:RuntimeGate;bytes:RuntimeGate;dpr:RuntimeGate;triangles:RuntimeGate;drawCalls:RuntimeGate};withinBudget:boolean};
  const observations=[] as Array<{category:string;strategy:string;requestedRenderers:string[];runtimeStates:string[];runtimeMetrics:RuntimeMetric[]}>;
  let providerFallback=true;
  let semanticOwnership=true;
  let observedBudgets=true;
  let resourceTimingObserved=true;
  let observedDeferredActivation=false;
  for(const category of categories){
    const response=await page.goto(`/benchmarks/${category}`,{waitUntil:"networkidle"});
    expect(response?.ok()).toBeTruthy();
    const pageRoot=page.locator(`[data-generated-page='${category}']`);
    await expect(pageRoot).toBeVisible();
    const nodes=pageRoot.locator("[data-page-node]");
    const strategy=(await nodes.evaluateAll((entries)=>entries.map((entry)=>entry.getAttribute("data-media-renderer")??"missing").join("|")));
    const stages=pageRoot.locator("[data-orchestrated-media]");
    const requestedRenderers=await stages.evaluateAll((entries)=>entries.map((entry)=>entry.getAttribute("data-media-requested-renderer")??"missing"));
    const runtimeMetrics:RuntimeMetric[]=[];
    for(let index=0;index<await stages.count();index+=1){
      const stage=stages.nth(index);
      const requested=await stage.getAttribute("data-media-requested-renderer");
      const lazyPriority=await stage.getAttribute("data-media-lazy-priority");
      const before=await stage.evaluate((element)=>{const rect=element.getBoundingClientRect();return{state:element.getAttribute("data-media-runtime-state")??"PENDING",intersecting:rect.bottom>=0&&rect.top<=window.innerHeight};});
      if(lazyPriority==="viewport"&&!before.intersecting&&(requested==="pixi"||requested==="three"))await expect(stage).toHaveAttribute("data-media-runtime-state","PENDING");
      if(lazyPriority==="viewport")await stage.scrollIntoViewIfNeeded();
      await expect(stage).toHaveAttribute("data-media-runtime-state",/ACTIVE|DOM_FALLBACK/,{timeout:20_000});
      const activation=await stage.getAttribute("data-media-activation");
      const afterState=await stage.getAttribute("data-media-runtime-state")??"PENDING";
      const deferred=lazyPriority==="viewport"&&!before.intersecting&&before.state==="PENDING"&&activation==="viewport"&&afterState==="ACTIVE";
      observedDeferredActivation=observedDeferredActivation||deferred;
      const budget={maxBytes:Number(await stage.getAttribute("data-media-max-bytes")),maxDpr:Number(await stage.getAttribute("data-media-max-dpr")),maxTriangles:Number(await stage.getAttribute("data-media-max-triangles")),maxDrawCalls:Number(await stage.getAttribute("data-media-max-draw-calls"))};
      semanticOwnership=semanticOwnership&&await stage.locator("xpath=ancestor::*[@data-page-node][1]").locator("[data-governed-section]").count()>=1;
      if(requested==="image"||requested==="video"){
        providerFallback=providerFallback&&(await stage.getAttribute("data-media-provider-state"))==="PROVIDER_NOT_ADMITTED"&&(await stage.getAttribute("data-media-runtime-state"))==="DOM_FALLBACK"&&(await stage.locator("img,video,canvas").count())===0;
      }
      const resourceTiming=await stage.evaluate((element):ResourceTimingObservation=>{
        if(typeof performance.getEntriesByType!=="function")return{state:"UNSUPPORTED",entryCount:0,initiatorTypes:[],transferBytes:0};
        const urls=new Set(Array.from(element.querySelectorAll<HTMLImageElement|HTMLVideoElement|HTMLSourceElement>("img,video,source")).flatMap((asset)=>{
          if(asset instanceof HTMLImageElement)return[asset.currentSrc||asset.src].filter(Boolean);
          if(asset instanceof HTMLVideoElement)return[asset.currentSrc||asset.src,asset.poster].filter(Boolean).map((value)=>new URL(value,document.baseURI).href);
          return[asset.src].filter(Boolean).map((value)=>new URL(value,document.baseURI).href);
        }));
        const entries=(performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((entry)=>urls.has(entry.name));
        const transferBytes=entries.reduce((sum,entry)=>sum+(entry.transferSize||entry.encodedBodySize||0),0);
        return{state:"OBSERVED",entryCount:entries.length,initiatorTypes:[...new Set(entries.map((entry)=>entry.initiatorType))].sort(),transferBytes};
      });
      let observed={transferBytes:resourceTiming.transferBytes,textureCount:0,textureBytes:0,dpr:0,triangles:0,drawCalls:0};
      if(requested==="pixi"&&(await stage.getAttribute("data-media-runtime-state"))==="ACTIVE"){
        const pixi=stage.locator("[data-graphics-state]");
        await expect(pixi).toHaveAttribute("data-graphics-state","ready",{timeout:20_000});
        await expect(pixi).not.toHaveAttribute("data-runtime-draw-calls","NOT_EXERCISED");
        observed={...observed,textureBytes:Number(await pixi.getAttribute("data-runtime-texture-bytes")),dpr:Number(await pixi.getAttribute("data-resolution")),drawCalls:Number(await pixi.getAttribute("data-runtime-draw-calls"))};
      }
      if(requested==="three"&&(await stage.getAttribute("data-media-runtime-state"))==="ACTIVE"){
        const three=stage.locator("[data-graphics3d-state]");
        await expect(three).toHaveAttribute("data-graphics3d-state","ready",{timeout:20_000});
        await expect(three).not.toHaveAttribute("data-graphics3d-draw-calls","NOT_EXERCISED",{timeout:20_000});
        observed={...observed,textureCount:Number(await three.getAttribute("data-graphics3d-texture-count")),textureBytes:Number(await three.getAttribute("data-graphics3d-texture-bytes")),dpr:Number(await three.getAttribute("data-graphics3d-dpr")),triangles:Number(await three.getAttribute("data-graphics3d-triangles")),drawCalls:Number(await three.getAttribute("data-graphics3d-draw-calls"))};
      }
      const evaluation=evaluateMediaRuntimeBudget(budget,{...observed,resourceTimingObserved:resourceTiming.state==="OBSERVED"});
      const withinBudget=evaluation.overall==="PASS";
      observedBudgets=observedBudgets&&withinBudget;
      resourceTimingObserved=resourceTimingObserved&&evaluation.gates.resourceTiming==="PASS";
      runtimeMetrics.push({sectionId:await stage.getAttribute("data-orchestrated-media")??"missing",renderer:requested??"missing",state:afterState,budget,observed,resourceTiming,lazy:{priority:lazyPriority??"missing",beforeState:before.state,initiallyIntersecting:before.intersecting,afterState,activation:activation??"missing",deferred},gates:evaluation.gates,withinBudget});
    }
    observations.push({category,strategy,requestedRenderers,runtimeStates:await stages.evaluateAll((entries)=>entries.map((entry)=>entry.getAttribute("data-media-runtime-state")??"PENDING")),runtimeMetrics});
  }

  await page.goto("/benchmarks/interactive-2d",{waitUntil:"networkidle"});
  const pixi=page.locator("[data-orchestrated-media][data-media-requested-renderer='pixi']").first();
  await expect(pixi).toHaveAttribute("data-media-runtime-state","ACTIVE",{timeout:20_000});
  await expect(pixi.locator("[data-pixi-canvas='true']")).toHaveCount(1,{timeout:20_000});
  const pixiRuntime=await pixi.locator("[data-pixi-canvas='true']").count()===1;

  await page.goto("/benchmarks/interactive-3d",{waitUntil:"networkidle"});
  const three=page.locator("[data-orchestrated-media][data-media-requested-renderer='three']").first();
  await expect(three).toHaveAttribute("data-media-runtime-state","ACTIVE",{timeout:20_000});
  await expect(three.locator("[data-r3f-canvas='true']")).toHaveCount(1,{timeout:20_000});
  const threeRuntime=await three.locator("[data-r3f-canvas='true']").count()===1;

  await page.goto("/benchmarks/interactive-2d?media=off&graphics=off",{waitUntil:"networkidle"});
  const forced2d=page.locator("[data-orchestrated-media]");
  await expect(forced2d.first()).toHaveAttribute("data-media-runtime-state","DOM_FALLBACK");
  const forced2dPass=await forced2d.locator("canvas").count()===0&&await page.locator("[data-generated-page='interactive-2d'] [data-governed-section]").count()>=5;
  await page.goto("/benchmarks/interactive-3d?media=off&graphics3d=off",{waitUntil:"networkidle"});
  const forced3d=page.locator("[data-orchestrated-media]");
  await expect(forced3d.first()).toHaveAttribute("data-media-runtime-state","DOM_FALLBACK");
  const forced3dPass=await forced3d.locator("canvas").count()===0&&await page.locator("[data-generated-page='interactive-3d'] [data-governed-section]").count()>=5;

  const lazyLoading=observedDeferredActivation;
  const gates={
    uniqueStrategies:new Set(observations.map((entry)=>entry.strategy)).size===6?"PASS" as const:"FAIL" as const,
    deliberateNoMedia:observations.find((entry)=>entry.category==="b2b-product")?.requestedRenderers.length===0?"PASS" as const:"FAIL" as const,
    providerFallback:providerFallback?"PASS" as const:"FAIL" as const,
    pixiRuntime:pixiRuntime?"PASS" as const:"FAIL" as const,
    threeRuntime:threeRuntime?"PASS" as const:"FAIL" as const,
    forcedFailureFallback:forced2dPass&&forced3dPass?"PASS" as const:"FAIL" as const,
    lazyLoading:lazyLoading?"PASS" as const:"FAIL" as const,
    resourceTiming:resourceTimingObserved?"PASS" as const:"FAIL" as const,
    observedBudgets:observedBudgets?"PASS" as const:"FAIL" as const,
    semanticOwnership:semanticOwnership?"PASS" as const:"FAIL" as const
  };
  const overall=Object.values(gates).every((state)=>state==="PASS")?"PASS" as const:"FAIL" as const;
  const receipt={schema:"website-design-compiler/media-orchestration-browser-receipt/v2",overall,git:exactGitIdentity(),categories:observations,gates};
  await validateAgainstSchema(receipt,"media-orchestration-browser-receipt.schema.json");
  const outputDirectory=join(process.cwd(),"artifacts","media-orchestration");
  await mkdir(outputDirectory,{recursive:true});
  await writeFile(join(outputDirectory,"browser-runtime-receipt.json"),`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
  expect(overall).toBe("PASS");
});
