export interface MotionRuntimeBudget{
  maxConcurrent:number;
  maxEffectMs:number;
  maxTotalMs:number;
  maxLongTaskMs:number;
  maxLayoutShift:number;
}
export interface MotionRuntimeObservation{
  peakConcurrent:number;
  maxPlannedEffectMs:number;
  plannedTotalMs:number;
  maxLongTaskMs:number;
  layoutShift:number;
  layoutPropertiesAnimated:boolean;
  mountedEffects:number;
  activeEffects:number;
  routeListeners:number;
  intersectionObservers:number;
  styleObservers:number;
  activeTimelines:number;
  routeCleanupCount:number;
  unmountCleanupCount:number;
  expectedEffectCount:number;
  longTaskObserverSupported:boolean;
  layoutShiftObserverSupported:boolean;
}
export type MotionRuntimeGate="PASS"|"FAIL";
export interface MotionRuntimeBudgetEvaluation{
  overall:MotionRuntimeGate;
  gates:{
    concurrencyBudget:MotionRuntimeGate;
    effectDurationBudget:MotionRuntimeGate;
    totalDurationBudget:MotionRuntimeGate;
    longTaskBudget:MotionRuntimeGate;
    layoutBudget:MotionRuntimeGate;
    routeChangeCleanup:MotionRuntimeGate;
    unmountCleanup:MotionRuntimeGate;
    listenerCardinality:MotionRuntimeGate;
    observerCardinality:MotionRuntimeGate;
    timelineCardinality:MotionRuntimeGate;
  };
}

function pass(value:boolean):MotionRuntimeGate{return value?"PASS":"FAIL";}
function finiteNonNegative(value:number):boolean{return Number.isFinite(value)&&value>=0;}

export function evaluateMotionRuntimeBudget(budget:MotionRuntimeBudget,observed:MotionRuntimeObservation):MotionRuntimeBudgetEvaluation{
  const gates={
    concurrencyBudget:pass(finiteNonNegative(observed.peakConcurrent)&&observed.peakConcurrent<=budget.maxConcurrent),
    effectDurationBudget:pass(finiteNonNegative(observed.maxPlannedEffectMs)&&observed.maxPlannedEffectMs<=budget.maxEffectMs),
    totalDurationBudget:pass(finiteNonNegative(observed.plannedTotalMs)&&observed.plannedTotalMs<=budget.maxTotalMs),
    longTaskBudget:pass(observed.longTaskObserverSupported&&finiteNonNegative(observed.maxLongTaskMs)&&observed.maxLongTaskMs<=budget.maxLongTaskMs),
    layoutBudget:pass(observed.layoutShiftObserverSupported&&finiteNonNegative(observed.layoutShift)&&observed.layoutShift<=budget.maxLayoutShift&&!observed.layoutPropertiesAnimated),
    routeChangeCleanup:pass(observed.routeCleanupCount===observed.expectedEffectCount),
    unmountCleanup:pass(observed.unmountCleanupCount===observed.expectedEffectCount&&observed.mountedEffects===0&&observed.activeEffects===0),
    listenerCardinality:pass(observed.routeListeners===0),
    observerCardinality:pass(observed.intersectionObservers===0&&observed.styleObservers===0),
    timelineCardinality:pass(observed.activeTimelines===0)
  };
  return{overall:Object.values(gates).every((state)=>state==="PASS")?"PASS":"FAIL",gates};
}
