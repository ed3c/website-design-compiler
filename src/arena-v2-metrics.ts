export type ArenaV2MetricState="PASS"|"FAIL"|"ABSENT"|"NOT_EXERCISED";
interface Receipt{overall?:unknown;}
interface GeneratedPagesReceipt extends Receipt{observed?:{screenshots?:number;categories?:number;projects?:number};}
interface DesignQualityReceipt extends Receipt{categoryCount?:number;viewportCoverage?:{mobile?:number;desktop?:number};premium?:{state?:unknown;evaluations?:Array<{card?:{score?:number}}>};}
export interface ArenaV2MetricInputs{
  responsive:Receipt|null;
  generatedPages:GeneratedPagesReceipt|null;
  motion:Receipt|null;
  motionRuntime:Receipt|null;
  media:Receipt|null;
  mediaRuntime:Receipt|null;
  designQuality:DesignQualityReceipt|null;
}
export interface ArenaV2Metrics{
  schema:"website-design-compiler/arena-v2-metrics/v2";
  responsiveComposition:{state:ArenaV2MetricState;screenshotCount:number};
  motionChoreography:{state:ArenaV2MetricState};
  mediaStrategyFit:{state:ArenaV2MetricState};
  designQuality:{state:ArenaV2MetricState;categoryCount:number;mobileCount:number;desktopCount:number;averageScore:number|null};
}
function paired(staticReceipt:Receipt|null,runtimeReceipt:Receipt|null):ArenaV2MetricState{
  if(!staticReceipt)return"ABSENT";
  if(staticReceipt.overall!=="PASS")return"FAIL";
  if(!runtimeReceipt)return"NOT_EXERCISED";
  return runtimeReceipt.overall==="PASS"?"PASS":"FAIL";
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
  return{
    schema:"website-design-compiler/arena-v2-metrics/v2",
    responsiveComposition:{state:responsiveState==="PASS"&&screenshotCount===18?"PASS":responsiveState==="PASS"?"FAIL":responsiveState,screenshotCount},
    motionChoreography:{state:paired(input.motion,input.motionRuntime)},
    mediaStrategyFit:{state:paired(input.media,input.mediaRuntime)},
    designQuality:{state:qualityState,categoryCount,mobileCount,desktopCount,averageScore:scores.length===0?null:Math.round(scores.reduce((sum,score)=>sum+score,0)/scores.length)}
  };
}
