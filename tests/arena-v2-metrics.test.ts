import assert from "node:assert/strict";
import test from "node:test";
import { evaluateArenaV2Metrics } from "../src/arena-v2-metrics.js";

const quality={overall:"PASS",categoryCount:6,viewportCoverage:{mobile:6,desktop:6},premium:{state:"PASS",evaluations:[{card:{score:82}},{card:{score:88}}]}};
const motionCategoryGates={concurrencyBudget:"PASS",effectDurationBudget:"PASS",totalDurationBudget:"PASS",longTaskBudget:"PASS",layoutBudget:"PASS",routeChangeCleanup:"PASS",unmountCleanup:"PASS",listenerCardinality:"PASS",observerCardinality:"PASS",timelineCardinality:"PASS"};
const motionRuntime={overall:"PASS",gates:{coherence:"PASS",reducedMotionFallback:"PASS",primaryInteractionUnblocked:"PASS"},categories:Array.from({length:6},()=>({gates:motionCategoryGates}))};
const mediaRuntime={overall:"PASS",gates:{uniqueStrategies:"PASS",deliberateNoMedia:"PASS",providerFallback:"PASS",pixiRuntime:"PASS",threeRuntime:"PASS",forcedFailureFallback:"PASS",lazyLoading:"PASS",resourceTiming:"PASS",observedBudgets:"PASS",semanticOwnership:"PASS"},categories:[]};
test("Arena reports responsive, motion, media and design quality independently",()=>{
  const result=evaluateArenaV2Metrics({responsive:{overall:"PASS"},generatedPages:{overall:"PASS",observed:{screenshots:18,categories:6,projects:3}},motion:{overall:"PASS"},motionRuntime,media:{overall:"PASS"},mediaRuntime,designQuality:quality});
  assert.equal(result.responsiveComposition.state,"PASS");
  assert.equal(result.motionChoreography.state,"PASS");
  assert.equal(result.motionCoherence.state,"PASS");
  assert.equal(result.motionAccessibility.state,"PASS");
  assert.equal(result.mediaStrategyFit.state,"PASS");
  assert.equal(result.mediaNecessity.state,"PASS");
  assert.equal(result.designQuality.state,"PASS");
  assert.equal(result.designQuality.averageScore,85);
});

test("static compiler receipts cannot impersonate missing browser evidence",()=>{
  const result=evaluateArenaV2Metrics({responsive:{overall:"PASS"},generatedPages:null,motion:{overall:"PASS"},motionRuntime:null,media:{overall:"PASS"},mediaRuntime:null,designQuality:null});
  assert.equal(result.responsiveComposition.state,"NOT_EXERCISED");
  assert.equal(result.motionChoreography.state,"NOT_EXERCISED");
  assert.equal(result.motionCoherence.state,"NOT_EXERCISED");
  assert.equal(result.motionAccessibility.state,"NOT_EXERCISED");
  assert.equal(result.mediaStrategyFit.state,"NOT_EXERCISED");
  assert.equal(result.mediaNecessity.state,"NOT_EXERCISED");
  assert.equal(result.designQuality.state,"ABSENT");
});

test("Arena keeps motion accessibility and media necessity independent from fit/coherence",()=>{
  const result=evaluateArenaV2Metrics({
    responsive:null,generatedPages:null,motion:{overall:"PASS"},
    motionRuntime:{...motionRuntime,gates:{...motionRuntime.gates,reducedMotionFallback:"FAIL"}},
    media:{overall:"PASS"},mediaRuntime:{...mediaRuntime,gates:{...mediaRuntime.gates,uniqueStrategies:"FAIL"}},designQuality:null
  });
  assert.equal(result.motionCoherence.state,"PASS");
  assert.equal(result.motionAccessibility.state,"FAIL");
  assert.equal(result.motionChoreography.state,"FAIL");
  assert.equal(result.mediaStrategyFit.state,"FAIL");
  assert.equal(result.mediaNecessity.state,"PASS");
});

test("incomplete premium viewport coverage fails design-quality metric",()=>{
  const result=evaluateArenaV2Metrics({responsive:null,generatedPages:null,motion:null,motionRuntime:null,media:null,mediaRuntime:null,designQuality:{...quality,viewportCoverage:{mobile:6,desktop:0}}});
  assert.equal(result.designQuality.state,"FAIL");
});
