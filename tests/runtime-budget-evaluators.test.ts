import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMediaRuntimeBudget } from "../src/media-runtime-budget.js";
import { evaluateMotionRuntimeBudget, type MotionRuntimeObservation } from "../src/motion-runtime-budget.js";

const motionObservation:MotionRuntimeObservation={peakConcurrent:3,maxPlannedEffectMs:700,plannedTotalMs:4000,maxLongTaskMs:40,layoutShift:0,layoutPropertiesAnimated:false,mountedEffects:0,activeEffects:0,routeListeners:0,intersectionObservers:0,styleObservers:0,activeTimelines:0,routeCleanupCount:6,unmountCleanupCount:6,expectedEffectCount:6,longTaskObserverSupported:true,layoutShiftObserverSupported:true};
const motionBudget={maxConcurrent:3,maxEffectMs:700,maxTotalMs:4000,maxLongTaskMs:50,maxLayoutShift:0};

test("motion runtime budget fails closed for performance and cleanup violations",()=>{
  assert.equal(evaluateMotionRuntimeBudget(motionBudget,motionObservation).overall,"PASS");
  const cases:Array<[keyof MotionRuntimeObservation,number|boolean,string]>=[
    ["peakConcurrent",4,"concurrencyBudget"],
    ["maxPlannedEffectMs",701,"effectDurationBudget"],
    ["plannedTotalMs",4001,"totalDurationBudget"],
    ["maxLongTaskMs",51,"longTaskBudget"],
    ["layoutShift",0.01,"layoutBudget"],
    ["layoutPropertiesAnimated",true,"layoutBudget"],
    ["routeListeners",1,"listenerCardinality"],
    ["intersectionObservers",1,"observerCardinality"],
    ["activeTimelines",1,"timelineCardinality"]
  ];
  for(const [key,value,gate] of cases){
    const evaluation=evaluateMotionRuntimeBudget(motionBudget,{...motionObservation,[key]:value});
    assert.equal(evaluation.overall,"FAIL",`${String(key)} must fail overall`);
    assert.equal(evaluation.gates[gate as keyof typeof evaluation.gates],"FAIL",`${String(key)} must fail ${gate}`);
  }
  assert.equal(evaluateMotionRuntimeBudget(motionBudget,{...motionObservation,longTaskObserverSupported:false}).gates.longTaskBudget,"FAIL");
  assert.equal(evaluateMotionRuntimeBudget(motionBudget,{...motionObservation,unmountCleanupCount:5}).gates.unmountCleanup,"FAIL");
});

test("media runtime budget uses observed Resource Timing and rejects each over-budget dimension",()=>{
  const budget={maxBytes:600_000,maxDpr:1.5,maxTriangles:2500,maxDrawCalls:8};
  const observed={transferBytes:10_000,textureBytes:20_000,dpr:1,triangles:412,drawCalls:3,resourceTimingObserved:true};
  assert.equal(evaluateMediaRuntimeBudget(budget,observed).overall,"PASS");
  assert.equal(evaluateMediaRuntimeBudget(budget,{...observed,resourceTimingObserved:false}).gates.resourceTiming,"FAIL");
  assert.equal(evaluateMediaRuntimeBudget(budget,{...observed,transferBytes:590_001}).gates.bytes,"FAIL");
  assert.equal(evaluateMediaRuntimeBudget(budget,{...observed,dpr:2}).gates.dpr,"FAIL");
  assert.equal(evaluateMediaRuntimeBudget(budget,{...observed,triangles:2501}).gates.triangles,"FAIL");
  assert.equal(evaluateMediaRuntimeBudget(budget,{...observed,drawCalls:9}).gates.drawCalls,"FAIL");
});
