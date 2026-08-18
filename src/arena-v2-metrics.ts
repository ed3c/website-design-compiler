export type ArenaV2MetricState="PASS"|"FAIL"|"ABSENT"|"NOT_EXERCISED";
interface Receipt{overall?:unknown;}
interface GeneratedPagesReceipt extends Receipt{observed?:{screenshots?:number;categories?:number;projects?:number};}
interface GateReceipt extends Receipt{gates?:Record<string,unknown>;categories?:Array<{gates?:Record<string,unknown>}>;}
interface DesignQualityReceipt extends Receipt{categoryCount?:number;viewportCoverage?:{mobile?:number;desktop?:number};premium?:{state?:unknown;evaluations?:Array<{card?:{score?:number}}>};}
export interface ArenaV2MetricInputs{
  responsive:Receipt|null;
  generatedPages:GeneratedPagesReceipt|null;
  motion:Receipt|null;
  motionRuntime:GateReceipt|null;
  media:Receipt|null;
  mediaRuntime:GateReceipt|null;
  designQuality:DesignQualityReceipt|null;
}
export interface ArenaV2Metrics{
  schema:"website-design-compiler/arena-v2-metrics/v2";
  responsiveComposition:{state:ArenaV2MetricState;screenshotCount:number};
  motionChoreography:{state:ArenaV2MetricState};
  motionCoherence:{state:ArenaV2MetricState};
  motionAccessibility:{state:ArenaV2MetricState};
  mediaStrategyFit:{state:ArenaV2MetricState};
  mediaNecessity:{state:ArenaV2MetricState};
  designQuality:{state:ArenaV2MetricState;categoryCount:number;mobileCount:number;desktopCount:number;averageScore:number|null};
}
function paired(staticReceipt:Receipt|null,runtimeReceipt:Receipt|null):ArenaV2MetricState{
  if(!staticReceipt)return"ABSENT";
  if(staticReceipt.overall!=="PASS")return"FAIL";
  if(!runtimeReceipt)return"NOT_EXERCISED";
  return runtimeReceipt.overall==="PASS"?"PASS":"FAIL";
}
function scopedRuntime(staticReceipt:Receipt|null,runtimeReceipt:GateReceipt|null,topLevelGates:string[],categoryGates:string[]=[]):ArenaV2MetricState{
  if(!staticReceipt)return"ABSENT";
  if(staticReceipt.overall!=="PASS")return"FAIL";
  if(!runtimeReceipt)return"NOT_EXERCISED";
  const topLevelPass=topLevelGates.every((gate)=>runtimeReceipt.gates?.[gate]==="PASS");
  const categories=runtimeReceipt.categories??[];
  const categoryPass=categoryGates.length===0||categories.length===6&&categories.every((entry)=>categoryGates.every((gate)=>entry.gates?.[gate]==="PASS"));
  return topLevelPass&&categoryPass?"PASS":"FAIL";
}
function combined(...states:ArenaV2MetricState[]):ArenaV2MetricState{
  if(states.includes("FAIL"))return"FAIL";
  if(states.includes("ABSENT"))return"ABSENT";
  if(states.includes("NOT_EXERCISED"))return"NOT_EXERCISED";
  return"PASS";
}
export function evaluateArenaV2Metrics(input:ArenaV2MetricInputs):ArenaV2Metrics{
  const screenshotCount=input.generatedPages?.observed?.screenshots??0;
  const responsiveState=paired(input.responsive,input.generatedPages);
  const quality=input.designQuality;
  const scores=(quality?.premium?.evaluations??[]).map((entry)=>entry.card?.score).filter((score):score is number=>typeof score==="number");
  const categoryCount=quality?.categoryCount??0;
  const mobileCount=quality?.viewportCoverage?.mobile??0;
  const desktopCount=quality?.viewportCoverage?.desktop??0;
  const qualityState=!quality?"ABSENT":quality.overall==="PASS"&&quality.premium?.state==="PASS"&&categoryCount===6&&mobileCount===6&&desktopCount===6?"PASS":"FAIL";
  const motionCoherence=scopedRuntime(input.motion,input.motionRuntime,["coherence"],["concurrencyBudget","effectDurationBudget","totalDurationBudget","routeChangeCleanup","unmountCleanup","listenerCardinality","observerCardinality","timelineCardinality"]);
  const motionAccessibility=scopedRuntime(input.motion,input.motionRuntime,["reducedMotionFallback","primaryInteractionUnblocked"],["layoutBudget"]);
  const mediaFit=scopedRuntime(input.media,input.mediaRuntime,["uniqueStrategies","providerFallback","pixiRuntime","threeRuntime","forcedFailureFallback","lazyLoading","resourceTiming","observedBudgets"]);
  const mediaNecessity=scopedRuntime(input.media,input.mediaRuntime,["deliberateNoMedia","semanticOwnership"]);
  return{
    schema:"website-design-compiler/arena-v2-metrics/v2",
    responsiveComposition:{state:responsiveState==="PASS"&&screenshotCount===18?"PASS":responsiveState==="PASS"?"FAIL":responsiveState,screenshotCount},
    motionChoreography:{state:combined(motionCoherence,motionAccessibility)},
    motionCoherence:{state:motionCoherence},
    motionAccessibility:{state:motionAccessibility},
    mediaStrategyFit:{state:mediaFit},
    mediaNecessity:{state:mediaNecessity},
    designQuality:{state:qualityState,categoryCount,mobileCount,desktopCount,averageScore:scores.length===0?null:Math.round(scores.reduce((sum,score)=>sum+score,0)/scores.length)}
  };
}
