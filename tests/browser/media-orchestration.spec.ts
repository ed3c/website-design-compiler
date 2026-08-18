import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARENA_CATEGORIES } from "../../src/arena.js";
import { validateAgainstSchema } from "../../src/validate.js";

const categories=ARENA_CATEGORIES;

test("generated pages execute bounded media strategies and deterministic fallbacks",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop-chromium","one browser lane owns the aggregate media runtime receipt");
  const observations=[] as Array<{category:string;strategy:string;requestedRenderers:string[];runtimeStates:string[]}>;
  let providerFallback=true;
  let semanticOwnership=true;
  let budgets=true;
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
    for(let index=0;index<await stages.count();index+=1){
      const stage=stages.nth(index);
      const requested=await stage.getAttribute("data-media-requested-renderer");
      const lazyPriority=await stage.getAttribute("data-media-lazy-priority");
      if(lazyPriority==="viewport")await stage.scrollIntoViewIfNeeded();
      await expect(stage).toHaveAttribute("data-media-runtime-state",/ACTIVE|DOM_FALLBACK/,{timeout:20_000});
      const activation=await stage.getAttribute("data-media-activation");
      observedDeferredActivation=observedDeferredActivation||activation==="viewport"||activation==="idle"||activation==="idle-timeout";
      const maxBytes=Number(await stage.getAttribute("data-media-max-bytes"));
      const maxDpr=Number(await stage.getAttribute("data-media-max-dpr"));
      const maxTriangles=Number(await stage.getAttribute("data-media-max-triangles"));
      const maxDrawCalls=Number(await stage.getAttribute("data-media-max-draw-calls"));
      budgets=budgets&&Number.isFinite(maxBytes)&&maxBytes<=1_500_000&&maxDpr<=1.5&&maxTriangles<=2500&&maxDrawCalls<=8;
      semanticOwnership=semanticOwnership&&await stage.locator("xpath=..").locator("[data-governed-section]").count()>=1;
      if(requested==="image"||requested==="video"){
        providerFallback=providerFallback&&(await stage.getAttribute("data-media-provider-state"))==="PROVIDER_NOT_ADMITTED"&&(await stage.getAttribute("data-media-runtime-state"))==="DOM_FALLBACK"&&(await stage.locator("img,video,canvas").count())===0;
      }
    }
    observations.push({category,strategy,requestedRenderers,runtimeStates:await stages.evaluateAll((entries)=>entries.map((entry)=>entry.getAttribute("data-media-runtime-state")??"PENDING"))});
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
    budgets:budgets?"PASS" as const:"FAIL" as const,
    semanticOwnership:semanticOwnership?"PASS" as const:"FAIL" as const
  };
  const overall=Object.values(gates).every((state)=>state==="PASS")?"PASS" as const:"FAIL" as const;
  const receipt={schema:"website-design-compiler/media-orchestration-browser-receipt/v1",overall,git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"},categories:observations,gates};
  await validateAgainstSchema(receipt,"media-orchestration-browser-receipt.schema.json");
  const outputDirectory=join(process.cwd(),"artifacts","media-orchestration");
  await mkdir(outputDirectory,{recursive:true});
  await writeFile(join(outputDirectory,"browser-runtime-receipt.json"),`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
  expect(overall).toBe("PASS");
});
