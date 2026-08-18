import type { DesignQualityBrowserObservation,RuntimeTokenMatch,VisualOriginalitySubject } from "../../src/design-quality-observation.js";
import type { QualityViewport } from "../../src/design-quality-eval.js";

export const tokenMatchPass:RuntimeTokenMatch={state:"PASS",matched:13,total:13,mismatches:[]};

export function qualityObservation(category:string,viewport:QualityViewport,distant=false):DesignQualityBrowserObservation{
  const project=viewport==="mobile"?"mobile-chromium":"desktop-chromium";
  return{
    schema:"website-design-compiler/design-quality-browser-observation/v1",category,project,viewport,git:{sha:"c".repeat(40),ref:"refs/heads/test"},
    screenshot:{path:`artifacts/design-quality-browser/screenshots/${project}--${category}.png`,sha256:"a".repeat(64),bytes:12000},
    pixels:{sourceWidth:viewport==="mobile"?412:1440,sourceHeight:2600,sampledPixels:8192,quantizedUniqueColors:distant?5:72,luminanceMean:distant?.98:.58,luminanceStdDev:distant?.01:.24,luminanceSpan:distant?.03:.72,edgeContrastMean:distant?.002:.12,colorEntropy:distant?.15:3.2,channels:{red:{mean:distant?.98:.24,stdDev:distant?.01:.25},green:{mean:distant?.98:.48,stdDev:distant?.01:.22},blue:{mean:distant?.98:.72,stdDev:distant?.01:.2}}},
    computed:{viewport:{width:viewport==="mobile"?412:1440,height:900},h1Count:1,h2Count:6,h1Px:64,medianH2Px:30,fontFamilies:["Test Display","Test Body"],sectionCount:7,sectionHeights:[260,340,420,310,480,280,240],sectionWidths:[1200,960,1200,840,1080,1200,960],renderedColumns:viewport==="mobile"?[1,1,1,1,1,1,1]:[1,2,3,2,3,1,1],layouts:distant?["stack","stack","stack","stack","stack","stack","stack"]:["list","split","grid","stage","grid","stack","list"],distinctSectionBackgrounds:distant?1:3,spacingGapMean:20,spacingGapStdDev:8,pageWidth:viewport==="mobile"?380:1200,pageHeight:2800,overflowX:false,ctaSectionCount:1,actionTargets:[{width:132,height:48,visible:true}],mediaStages:distant?0:2,motionStates:Array.from({length:7},()=>"CLEANED"),contentBudgetPass:true,cssTokens:{"--wdc-color-background":"oklch(1 0 0)","--wdc-color-surface":"oklch(.9 0 0)","--wdc-color-text-primary":"oklch(.2 0 0)","--wdc-color-text-muted":"oklch(.4 0 0)","--wdc-color-accent":"oklch(.5 .1 20)","--wdc-color-on-accent":"oklch(1 0 0)","--wdc-color-focus":"oklch(.5 .1 20)","--wdc-font-display":"Test Display","--wdc-font-body":"Test Body","--wdc-space-sm":"16px","--wdc-space-md":"24px","--wdc-space-lg":"40px","--wdc-motion-fast":"120ms","--wdc-motion-base":"180ms","--wdc-container-max":"1200px","--wdc-gutter":"32px"}},
    accessibility:{seriousCriticalViolationCount:0,ruleIds:[]}
  };
}

export function distantVisualCorpus(viewport:QualityViewport):VisualOriginalitySubject[]{return[{id:"distant-reference",observation:qualityObservation("distant-reference",viewport,true)}];}
