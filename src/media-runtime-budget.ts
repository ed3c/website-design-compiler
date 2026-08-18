export interface MediaRuntimeBudget{
  maxBytes:number;
  maxDpr:number;
  maxTriangles:number;
  maxDrawCalls:number;
}
export interface MediaRuntimeObservation{
  transferBytes:number;
  textureBytes:number;
  dpr:number;
  triangles:number;
  drawCalls:number;
  resourceTimingObserved:boolean;
}
export type MediaRuntimeGate="PASS"|"FAIL";
export interface MediaRuntimeBudgetEvaluation{
  overall:MediaRuntimeGate;
  gates:{resourceTiming:MediaRuntimeGate;bytes:MediaRuntimeGate;dpr:MediaRuntimeGate;triangles:MediaRuntimeGate;drawCalls:MediaRuntimeGate};
}

function pass(value:boolean):MediaRuntimeGate{return value?"PASS":"FAIL";}
function finiteNonNegative(value:number):boolean{return Number.isFinite(value)&&value>=0;}

export function evaluateMediaRuntimeBudget(budget:MediaRuntimeBudget,observed:MediaRuntimeObservation):MediaRuntimeBudgetEvaluation{
  const gates={
    resourceTiming:pass(observed.resourceTimingObserved),
    bytes:pass(finiteNonNegative(observed.transferBytes)&&finiteNonNegative(observed.textureBytes)&&observed.transferBytes+observed.textureBytes<=budget.maxBytes),
    dpr:pass(finiteNonNegative(observed.dpr)&&observed.dpr<=budget.maxDpr),
    triangles:pass(finiteNonNegative(observed.triangles)&&observed.triangles<=budget.maxTriangles),
    drawCalls:pass(finiteNonNegative(observed.drawCalls)&&observed.drawCalls<=budget.maxDrawCalls)
  };
  return{overall:Object.values(gates).every((state)=>state==="PASS")?"PASS":"FAIL",gates};
}
