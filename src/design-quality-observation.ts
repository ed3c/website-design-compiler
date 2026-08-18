export interface DesignQualityBrowserObservation{
  schema:"website-design-compiler/design-quality-browser-observation/v1";
  category:string;
  project:"desktop-chromium"|"mobile-chromium";
  viewport:"desktop"|"mobile";
  git:{sha:string;ref:string};
  screenshot:{path:string;sha256:string;bytes:number};
  pixels:{sourceWidth:number;sourceHeight:number;sampledPixels:number;quantizedUniqueColors:number;luminanceMean:number;luminanceStdDev:number;luminanceSpan:number;edgeContrastMean:number;colorEntropy:number;channels:{red:{mean:number;stdDev:number};green:{mean:number;stdDev:number};blue:{mean:number;stdDev:number}}};
  computed:{viewport:{width:number;height:number};h1Count:number;h2Count:number;h1Px:number;medianH2Px:number;fontFamilies:string[];minimumTextContrastRatio:number;sectionCount:number;sectionHeights:number[];sectionWidths:number[];renderedColumns:number[];layouts:string[];distinctSectionBackgrounds:number;spacingGapMean:number;spacingGapStdDev:number;pageWidth:number;pageHeight:number;overflowX:boolean;ctaSectionCount:number;actionTargets:Array<{width:number;height:number;visible:boolean}>;mediaStages:number;motionStates:string[];contentBudgetPass:boolean;cssTokens:Record<string,string>};
  accessibility:{seriousCriticalViolationCount:number;ruleIds:string[]};
}

export interface RuntimeTokenMatch{state:"PASS"|"FAIL";matched:number;total:number;mismatches:string[]}
export interface VisualOriginalitySubject{id:string;observation:DesignQualityBrowserObservation}

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
function mean(values:readonly number[]):number{return values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);}

export function visualFingerprint(observation:DesignQualityBrowserObservation):number[]{
  const headingRatio=observation.computed.medianH2Px>0?observation.computed.h1Px/observation.computed.medianH2Px:0;
  return[
    clamp01(observation.pixels.luminanceMean),clamp01(observation.pixels.luminanceStdDev*5),clamp01(observation.pixels.luminanceSpan*3),clamp01(observation.pixels.edgeContrastMean*20),clamp01(observation.pixels.colorEntropy/4),
    observation.pixels.channels.red.mean,observation.pixels.channels.green.mean,observation.pixels.channels.blue.mean,clamp01(observation.pixels.channels.red.stdDev*4),clamp01(observation.pixels.channels.green.stdDev*4),clamp01(observation.pixels.channels.blue.stdDev*4),
    clamp01(headingRatio/4),clamp01(observation.computed.distinctSectionBackgrounds/4),clamp01(mean(observation.computed.renderedColumns)/4),clamp01(new Set(observation.computed.layouts).size/6),
    clamp01(observation.computed.mediaStages/4),clamp01(observation.computed.sectionCount/10),clamp01((observation.computed.pageHeight/Math.max(1,observation.computed.sectionCount))/800)
  ];
}

export function visualObservationSimilarity(left:DesignQualityBrowserObservation,right:DesignQualityBrowserObservation):number{
  const a=visualFingerprint(left);const b=visualFingerprint(right);
  return clamp01(1-mean(a.map((value,index)=>Math.abs(value-b[index]!))));
}
