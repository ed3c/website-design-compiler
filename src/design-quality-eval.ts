import type { CompletePageGraph } from "./complete-page-graph.js";

export type QualityViewport="mobile"|"desktop";
export interface DesignQualityDimensions { hierarchy:number; typography:number; composition:number; rhythm:number; sectionTransitions:number; density:number; contrast:number; ctaClarity:number; responsiveCoherence:number; mediaRestraint:number; motionRestraint:number; differentiation:number; originality:number; }
export interface VisualQualityObservation {
  schema:"website-design-compiler/generated-page-visual-observation/v1";
  category:string;
  project:string;
  viewport:{width:number;height:number};
  nodeCount:number;
  sectionKinds:string[];
  typography:{families:string[];headingToBodyRatio:number;distinctHeadingSizes:number};
  contrast:{minimumRatio:number;sampleCount:number};
  rhythm:{averageVerticalGap:number;distinctBackgrounds:number;sectionTransitions:number};
  ctaCount:number;
  clippedTextCount:number;
}
export interface OriginalityAudit {
  state:"PASS"|"FAIL";
  threshold:number;
  maxReferenceSimilarity:number;
  maxCorpusSimilarity:number;
  nearestReference:string|null;
  nearestCorpus:string|null;
  reasons:string[];
}
export interface DesignQualityScorecard {
  schema:"website-design-compiler/design-quality-eval/v2";
  category:string;
  viewport:QualityViewport;
  graphSignature:string;
  threshold:number;
  score:number;
  overall:"PASS"|"FAIL";
  visualEvidenceState:"PASS"|"NOT_EXERCISED";
  dimensions:DesignQualityDimensions;
  penalties:string[];
  originalityAudit:OriginalityAudit;
  intent:{mode:"CONVERSION"|"INFORMATION";requiredConversionSteps:number;ctaRequired:boolean};
}
export interface OriginalitySubject { id:string; signature:string; }
interface QualityIntent { mode:"CONVERSION"|"INFORMATION"; requiredConversionSteps:number; ctaRequired:boolean; }
const CATEGORY_QUALITY_INTENTS:Record<string,QualityIntent>={
  "b2b-product":{mode:"CONVERSION",requiredConversionSteps:2,ctaRequired:true},
  editorial:{mode:"INFORMATION",requiredConversionSteps:0,ctaRequired:false},
  "premium-consumer-brand":{mode:"CONVERSION",requiredConversionSteps:2,ctaRequired:true},
  "motion-heavy-creative":{mode:"CONVERSION",requiredConversionSteps:2,ctaRequired:true},
  "interactive-2d":{mode:"CONVERSION",requiredConversionSteps:2,ctaRequired:true},
  "interactive-3d":{mode:"CONVERSION",requiredConversionSteps:2,ctaRequired:true}
};
const clamp=(value:number)=>Math.max(0,Math.min(100,Math.round(value)));
function duplicates(values:string[]):number{return values.length-new Set(values).size;}
function signatureTokens(signature:string):Set<string>{return new Set(signature.split("|").map((value)=>value.trim()).filter(Boolean));}
function qualityIntent(graph:CompletePageGraph):QualityIntent{return CATEGORY_QUALITY_INTENTS[graph.category]??{mode:"CONVERSION",requiredConversionSteps:2,ctaRequired:true};}
function informationProgressionCount(graph:CompletePageGraph):number{return graph.nodes.filter((node)=>node.kind!=="navigation"&&node.kind!=="footer").length;}
export function graphSignatureSimilarity(a:string,b:string):number{
  if(a===b)return 1;
  const left=signatureTokens(a);const right=signatureTokens(b);
  const union=new Set([...left,...right]);if(union.size===0)return 1;
  let intersection=0;for(const token of left)if(right.has(token))intersection+=1;
  return intersection/union.size;
}
export function auditGraphOriginality(signature:string,references:readonly OriginalitySubject[]=[],corpus:readonly OriginalitySubject[]=[],threshold=0.82):OriginalityAudit{
  const nearest=(subjects:readonly OriginalitySubject[])=>subjects.map((subject)=>({id:subject.id,similarity:graphSignatureSimilarity(signature,subject.signature)})).sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id))[0]??null;
  const reference=nearest(references);const corpusMatch=nearest(corpus);
  const reasons:string[]=[];
  if(reference&&reference.similarity>=threshold)reasons.push(`reference-structure-too-close:${reference.id}:${reference.similarity.toFixed(3)}>=${threshold.toFixed(3)}`);
  if(corpusMatch&&corpusMatch.similarity>=threshold)reasons.push(`corpus-structure-too-close:${corpusMatch.id}:${corpusMatch.similarity.toFixed(3)}>=${threshold.toFixed(3)}`);
  return{state:reasons.length===0?"PASS":"FAIL",threshold,maxReferenceSimilarity:reference?.similarity??0,maxCorpusSimilarity:corpusMatch?.similarity??0,nearestReference:reference?.id??null,nearestCorpus:corpusMatch?.id??null,reasons};
}
export function evaluateDesignQuality(graph:CompletePageGraph,viewport:QualityViewport,threshold=78,originalityReferences:readonly OriginalitySubject[]=[],originalityCorpus:readonly OriginalitySubject[]=[],originalitySimilarityThreshold=0.82,visual?:VisualQualityObservation):DesignQualityScorecard{
  const kinds=graph.nodes.map((node)=>node.kind);
  const layouts=graph.nodes.map((node)=>node.responsive[viewport].layout);
  const renderers=graph.nodes.map((node)=>node.mediaHook.renderer);
  const engines=graph.nodes.map((node)=>node.motionHook.engine);
  const intent=qualityIntent(graph);
  const penalties:string[]=[];
  const repeatedKinds=duplicates(kinds);if(repeatedKinds>1)penalties.push("repetitive-section-template");
  const gpuCount=renderers.filter((renderer)=>renderer==="pixi"||renderer==="three").length;if(gpuCount>2)penalties.push("gratuitous-gpu-complexity");
  const animatedRatio=engines.filter((engine)=>engine!=="none").length/Math.max(1,engines.length);if(animatedRatio>0.95)penalties.push("motion-applied-to-nearly-every-section");
  if(intent.mode==="CONVERSION"&&graph.conversionPath.length<intent.requiredConversionSteps)penalties.push("weak-conversion-path");
  if(intent.ctaRequired&&!kinds.includes("cta"))penalties.push("required-cta-missing");
  if(!visual)penalties.push("browser-visual-evidence-not-exercised");
  if(visual&&visual.clippedTextCount>0)penalties.push(`clipped-text:${visual.clippedTextCount}`);
  const originalityAudit=auditGraphOriginality(graph.signature,originalityReferences,originalityCorpus,originalitySimilarityThreshold);
  if(originalityAudit.state==="FAIL")penalties.push(...originalityAudit.reasons);
  const layoutVariety=new Set(layouts).size;
  const rendererVariety=new Set(renderers).size;
  const sectionVariety=new Set(kinds).size;
  const originalityDistance=Math.min(1-originalityAudit.maxReferenceSimilarity,1-originalityAudit.maxCorpusSimilarity);
  const progression=intent.mode==="INFORMATION"?informationProgressionCount(graph):graph.conversionPath.length;
  const ctaClarity=intent.ctaRequired?clamp(62+graph.conversionPath.length*7):clamp(76+Math.min(12,progression*3));
  const visualHierarchy=visual?visual.typography.headingToBodyRatio>=1.75?94:visual.typography.headingToBodyRatio>=1.4?78:48:0;
  const typography=visual?clamp(58+Math.min(18,visual.typography.distinctHeadingSizes*7)+Math.min(14,visual.typography.families.length*5)):0;
  const contrast=visual?clamp(visual.contrast.minimumRatio>=7?96:visual.contrast.minimumRatio>=4.5?88:visual.contrast.minimumRatio>=3?62:35):0;
  const sectionTransitions=visual?clamp(52+Math.min(24,visual.rhythm.sectionTransitions*6)+Math.min(18,visual.rhythm.distinctBackgrounds*5)):0;
  const dimensions:DesignQualityDimensions={
    hierarchy:visual?clamp((70+Math.min(20,progression*5)-(graph.nodes[0]?.kind==="navigation"?0:25)+visualHierarchy)/2):0,
    typography,
    composition:clamp(62+layoutVariety*9-repeatedKinds*8),
    rhythm:visual?clamp(62+Math.min(18,sectionVariety*3)-repeatedKinds*7+Math.min(12,visual.rhythm.averageVerticalGap/4)):0,
    sectionTransitions,
    density:visual&&visual.clippedTextCount===0?clamp(viewport==="mobile"?graph.nodes.every((node)=>node.responsive.mobile.columns===1||node.responsive.mobile.layout==="stage")?90:55:82):35,
    contrast,
    ctaClarity,
    responsiveCoherence:clamp(graph.nodes.every((node)=>node.responsive.semanticOrder==="DOM_STABLE")?92:35),
    mediaRestraint:clamp(92-gpuCount*8-Math.max(0,renderers.filter((renderer)=>renderer!=="dom").length-Math.ceil(graph.nodes.length*0.6))*7),
    motionRestraint:clamp(92-Math.max(0,animatedRatio-0.8)*60),
    differentiation:clamp(64+layoutVariety*7+rendererVariety*5),
    originality:clamp(80-repeatedKinds*10-Math.max(0,0.7-originalityDistance)*70)
  };
  const values=Object.values(dimensions);const score=clamp(values.reduce((sum,value)=>sum+value,0)/values.length-penalties.length*3);
  const visualEvidenceState=visual?"PASS":"NOT_EXERCISED";
  return{schema:"website-design-compiler/design-quality-eval/v2",category:graph.category,viewport,graphSignature:graph.signature,threshold,score,overall:score>=threshold&&originalityAudit.state==="PASS"&&visualEvidenceState==="PASS"?"PASS":"FAIL",visualEvidenceState,dimensions,penalties,originalityAudit,intent};
}
