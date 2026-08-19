import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileAllSectionPageFixtures } from "../../src/section-page-fixtures.js";
import { compileMotionChoreography } from "../../src/motion-choreography.js";
import { evaluateMotionRuntimeBudget, type MotionRuntimeObservation } from "../../src/motion-runtime-budget.js";
import { ARENA_CATEGORIES } from "../../src/arena.js";
import { validateAgainstSchema } from "../../src/validate.js";
import { exactGitIdentity } from "./evidence-git.js";

type MotionMetrics={active:number;peak:number;mountedEffects:number;routeListeners:number;intersectionObservers:number;styleObservers:number;activeTimelines:number;routeCleanupCount:number;unmountCleanupCount:number;plannedTotalMs:number;maxPlannedEffectMs:number;layoutPropertiesAnimated:boolean;animatedProperties:string[];registeredEffectIds:string[]};
type MotionPerf={maxLongTaskMs:number;layoutShift:number;longTaskObserverSupported:boolean;layoutShiftObserverSupported:boolean};
const categories=ARENA_CATEGORIES;
const plans=new Map(compileAllSectionPageFixtures().map((page)=>[page.category,compileMotionChoreography(page)]));

test("route cleanup remains durable when it interrupts an active Motion animation",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop-chromium","one browser lane owns the asynchronous cleanup regression");
  const response=await page.goto("/benchmarks/b2b-product?media=off&graphics=off&graphics3d=off",{waitUntil:"domcontentloaded"});
  expect(response?.ok()).toBeTruthy();
  const nodes=page.locator("[data-page-node]");
  await expect.poll(
    ()=>nodes.evaluateAll((entries)=>entries.some((entry)=>entry.getAttribute("data-motion-engine")==="motion"&&entry.getAttribute("data-motion-runtime")==="ACTIVE")),
    {message:"the regression must interrupt a live Motion animation"}
  ).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event("wdc:generated-motion:route-change")));
  await expect.poll(
    ()=>nodes.evaluateAll((entries)=>entries.every((entry)=>entry.getAttribute("data-motion-runtime")==="CLEANED")),
    {message:"route cleanup must synchronously own every generated motion node"}
  ).toBe(true);
  await page.waitForTimeout(600);
  expect(await nodes.evaluateAll((entries)=>entries.every((entry)=>entry.getAttribute("data-motion-runtime")==="CLEANED")),"a stopped Motion promise must not overwrite CLEANED after route disposal").toBe(true);
});

test("generated motion records bounded performance and zero leaked resources after route cleanup and true unmount",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop-chromium","one browser lane owns the aggregate motion runtime receipt");
  await page.addInitScript(()=>{
    type RuntimeWindow=typeof window&{__wdcGeneratedMotion?:{active:number};__wdcMotionPerf?:MotionPerf};
    const runtime=window as RuntimeWindow;
    const supported=new Set(PerformanceObserver.supportedEntryTypes??[]);
    const perf:MotionPerf={maxLongTaskMs:0,layoutShift:0,longTaskObserverSupported:supported.has("longtask"),layoutShiftObserverSupported:supported.has("layout-shift")};
    runtime.__wdcMotionPerf=perf;
    if(perf.longTaskObserverSupported)new PerformanceObserver((list)=>{for(const entry of list.getEntries())if((runtime.__wdcGeneratedMotion?.active??0)>0)perf.maxLongTaskMs=Math.max(perf.maxLongTaskMs,entry.duration);}).observe({type:"longtask",buffered:true});
    if(perf.layoutShiftObserverSupported)new PerformanceObserver((list)=>{for(const entry of list.getEntries()){const shift=entry as PerformanceEntry&{value?:number;hadRecentInput?:boolean};if((runtime.__wdcGeneratedMotion?.active??0)>0&&!shift.hadRecentInput)perf.layoutShift+=shift.value??0;}}).observe({type:"layout-shift",buffered:true});
  });

  const observations=[];
  for(const category of categories){
    const plan=plans.get(category)!;
    // Motion owns this performance lane. Rich media has a separate runtime budget suite;
    // disabling it here prevents Pixi/Three initialization from being attributed to motion.
    const response=await page.goto(`/benchmarks/${category}?media=off&graphics=off&graphics3d=off`,{waitUntil:"networkidle"});
    expect(response?.ok()).toBeTruthy();
    const root=page.locator(`[data-generated-page='${category}']`);
    const nodes=root.locator("[data-page-node]");
    const expectedEffectCount=await nodes.count();
    await page.waitForFunction((count)=>{
      const metrics=(window as typeof window&{__wdcGeneratedMotion?:{mountedEffects:number;routeListeners:number}}).__wdcGeneratedMotion;
      return metrics?.mountedEffects===count&&metrics.routeListeners===count;
    },expectedEffectCount);
    for(let index=0;index<expectedEffectCount;index+=1)await nodes.nth(index).scrollIntoViewIfNeeded();
    await page.evaluate(()=>window.dispatchEvent(new Event("wdc:generated-motion:route-change")));
    await expect(nodes).toHaveCount(expectedEffectCount);
    expect(await nodes.evaluateAll((entries)=>entries.every((entry)=>entry.getAttribute("data-motion-runtime")==="CLEANED"&&entry.getAttribute("data-motion-cleanup-observed")==="true"))).toBe(true);
    await page.waitForTimeout(100);
    expect(await nodes.evaluateAll((entries)=>entries.every((entry)=>entry.getAttribute("data-motion-runtime")==="CLEANED"&&entry.getAttribute("data-motion-cleanup-observed")==="true")),"an interrupted animation must not overwrite its durable CLEANED state").toBe(true);
    await page.evaluate(()=>window.dispatchEvent(new Event("wdc:generated-page:unmount")));
    await expect(root).toHaveAttribute("data-page-mounted","false");
    await expect(nodes).toHaveCount(0);
    await page.waitForFunction(()=>{
      const metrics=(window as typeof window&{__wdcGeneratedMotion?:{mountedEffects:number;active:number;routeListeners:number;intersectionObservers:number;styleObservers:number;activeTimelines:number}}).__wdcGeneratedMotion;
      return Boolean(metrics&&metrics.mountedEffects===0&&metrics.active===0&&metrics.routeListeners===0&&metrics.intersectionObservers===0&&metrics.styleObservers===0&&metrics.activeTimelines===0);
    });
    await page.waitForTimeout(75);
    const runtime=await page.evaluate(()=>({
      metrics:(window as typeof window&{__wdcGeneratedMotion:MotionMetrics}).__wdcGeneratedMotion,
      performance:(window as typeof window&{__wdcMotionPerf:MotionPerf}).__wdcMotionPerf
    }));
    const observed:MotionRuntimeObservation={peakConcurrent:runtime.metrics.peak,maxPlannedEffectMs:runtime.metrics.maxPlannedEffectMs,plannedTotalMs:runtime.metrics.plannedTotalMs,maxLongTaskMs:runtime.performance.maxLongTaskMs,layoutShift:runtime.performance.layoutShift,layoutPropertiesAnimated:runtime.metrics.layoutPropertiesAnimated,mountedEffects:runtime.metrics.mountedEffects,activeEffects:runtime.metrics.active,routeListeners:runtime.metrics.routeListeners,intersectionObservers:runtime.metrics.intersectionObservers,styleObservers:runtime.metrics.styleObservers,activeTimelines:runtime.metrics.activeTimelines,routeCleanupCount:runtime.metrics.routeCleanupCount,unmountCleanupCount:runtime.metrics.unmountCleanupCount,expectedEffectCount,longTaskObserverSupported:runtime.performance.longTaskObserverSupported,layoutShiftObserverSupported:runtime.performance.layoutShiftObserverSupported};
    const evaluation=evaluateMotionRuntimeBudget(plan.budget,observed);
    observations.push({category,budget:plan.budget,observed,animatedProperties:runtime.metrics.animatedProperties,gates:evaluation.gates,overall:evaluation.overall});
  }

  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/benchmarks/motion-heavy-creative?media=off&graphics=off&graphics3d=off",{waitUntil:"networkidle"});
  const reducedNodes=page.locator("[data-page-node]");
  await expect(reducedNodes.first()).toHaveAttribute("data-motion-runtime","VISIBLE_NO_MOTION");
  const reducedMotionFallback=await reducedNodes.evaluateAll((entries)=>entries.every((entry)=>entry.getAttribute("data-motion-runtime")==="VISIBLE_NO_MOTION"&&getComputedStyle(entry).opacity==="1"));
  const primaryInteractionUnblocked=await page.getByRole("link").first().isEnabled();
  const gates={
    coherence:observations.every((entry)=>entry.overall==="PASS")?"PASS" as const:"FAIL" as const,
    reducedMotionFallback:reducedMotionFallback?"PASS" as const:"FAIL" as const,
    primaryInteractionUnblocked:primaryInteractionUnblocked?"PASS" as const:"FAIL" as const
  };
  const overall=Object.values(gates).every((state)=>state==="PASS")?"PASS" as const:"FAIL" as const;
  const receipt={schema:"website-design-compiler/motion-choreography-browser-receipt/v2",overall,git:exactGitIdentity(),categories:observations,gates};
  await validateAgainstSchema(receipt,"motion-choreography-browser-receipt.schema.json");
  const outputDirectory=join(process.cwd(),"artifacts","motion-choreography");
  await mkdir(outputDirectory,{recursive:true});
  await writeFile(join(outputDirectory,"browser-runtime-receipt.json"),`${JSON.stringify(receipt,null,2)}\n`,"utf8");
  expect(overall,JSON.stringify(observations.filter((entry)=>entry.overall!=="PASS").map((entry)=>({category:entry.category,gates:entry.gates,observed:entry.observed})))).toBe("PASS");
});
