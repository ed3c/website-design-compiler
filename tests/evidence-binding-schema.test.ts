import assert from "node:assert/strict";
import test from "node:test";
import { validateAgainstSchema } from "../src/validate.js";

const git={sha:"a".repeat(40),tree:"b".repeat(40),ref:"refs/heads/evidence"};
const pass="PASS" as const;

test("motion and media browser receipt schemas require exact SHA/tree/ref and reject UNBOUND",async()=>{
  const motionGates={concurrencyBudget:pass,effectDurationBudget:pass,totalDurationBudget:pass,longTaskBudget:pass,layoutBudget:pass,routeChangeCleanup:pass,unmountCleanup:pass,listenerCardinality:pass,observerCardinality:pass,timelineCardinality:pass};
  const motionCategory={category:"fixture",budget:{maxConcurrent:3,maxEffectMs:700,maxTotalMs:4000,maxLongTaskMs:50,maxLayoutShift:0,layoutPropertiesAllowed:false},observed:{activeEffects:0,peakConcurrent:1,mountedEffects:0,routeListeners:0,intersectionObservers:0,styleObservers:0,activeTimelines:0,routeCleanupCount:1,unmountCleanupCount:1,plannedTotalMs:200,maxPlannedEffectMs:200,layoutPropertiesAnimated:false,maxLongTaskMs:0,layoutShift:0,longTaskObserverSupported:true,layoutShiftObserverSupported:true,expectedEffectCount:1},animatedProperties:["opacity"],gates:motionGates,overall:pass};
  const motion={schema:"website-design-compiler/motion-choreography-browser-receipt/v2",overall:pass,git,categories:Array.from({length:6},(_,index)=>({...motionCategory,category:`fixture-${index}`})),gates:{coherence:pass,reducedMotionFallback:pass,primaryInteractionUnblocked:pass}};
  await validateAgainstSchema(motion,"motion-choreography-browser-receipt.schema.json");
  await assert.rejects(validateAgainstSchema({...motion,git:{sha:"UNBOUND",tree:git.tree,ref:git.ref}},"motion-choreography-browser-receipt.schema.json"),/pattern/);

  const mediaGates={uniqueStrategies:pass,deliberateNoMedia:pass,providerFallback:pass,pixiRuntime:pass,threeRuntime:pass,forcedFailureFallback:pass,lazyLoading:pass,resourceTiming:pass,observedBudgets:pass,semanticOwnership:pass};
  const mediaCategory={category:"fixture",strategy:"dom",requestedRenderers:[],runtimeStates:[],runtimeMetrics:[]};
  const media={schema:"website-design-compiler/media-orchestration-browser-receipt/v2",overall:pass,git,categories:Array.from({length:6},(_,index)=>({...mediaCategory,category:`fixture-${index}`})),gates:mediaGates};
  await validateAgainstSchema(media,"media-orchestration-browser-receipt.schema.json");
  await assert.rejects(validateAgainstSchema({...media,git:{sha:git.sha,ref:git.ref}},"media-orchestration-browser-receipt.schema.json"),/tree/);
  await assert.rejects(validateAgainstSchema({...media,git:{sha:git.sha,tree:git.tree,ref:"UNBOUND"}},"media-orchestration-browser-receipt.schema.json"),/pattern/);
});
