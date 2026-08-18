import type { CompletePageGraph } from "./complete-page-graph.js";
import { visualObservationSimilarity,type DesignQualityBrowserObservation,type RuntimeTokenMatch,type VisualOriginalitySubject } from "./design-quality-observation.js";
import { calibratedVisualSimilarity,orderedTokenSimilarity,pageGraphStructureSignature } from "./design-quality-calibration.js";

export type QualityViewport="mobile"|"desktop";
export interface DesignQualityDimensions { hierarchy:number; composition:number; rhythm:number; density:number; ctaClarity:number; responsiveCoherence:number; mediaRestraint:number; motionRestraint:number; differentiation:number; originality:number; }
export interface OriginalityAudit {
  state:"PASS"|"FAIL";
  threshold:number;
  maxReferenceSimilarity:number;
  maxCorpusSimilarity:number;
  nearestReference:string|null;
  nearestCorpus:string|null;
  maxVisualReferenceSimilarity:number;
  maxVisualCorpusSimilarity:number;
  nearestVisualReference:string|null;
  nearestVisualCorpus:string|null;
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
  dimensions:DesignQualityDimensions;
  penalties:string[];
  originalityAudit:OriginalityAudit;
  measurement:{state:"PASS"|"FAIL"|"ABSENT";observationSchema:string|null;screenshotSha256:string|null;tokenMatch:RuntimeTokenMatch|null};
  intent:{mode:"CONVERSION"|"INFORMATION";requiredConversionSteps:number;ctaRequired:boolean};
}
export interface DesignQualityScorecardV3 extends Omit<DesignQualityScorecard,"schema"> {
  schema:"website-design-compiler/design-quality-eval/v3";
  methods:{scoreModel:"runtime-evidence-weighted/v3";structuralSimilarity:"ordered-page-graph/v1";visualSimilarity:"calibrated-visual/v1"};
}
export interface OriginalitySubject { id:string; signature:string; }
export interface OrderedOriginalitySubject { id:string; graph:CompletePageGraph; }
export interface DesignQualityV3Evidence {
  premiumQualityThreshold?:number;
  originalitySimilarityThreshold?:number;
  structuralReferences?:readonly OrderedOriginalitySubject[];
  structuralCorpus?:readonly OrderedOriginalitySubject[];
  observation?:DesignQualityBrowserObservation|null;
  tokenMatch?:RuntimeTokenMatch|null;
  visualReferences?:readonly VisualOriginalitySubject[];
  visualCorpus?:readonly VisualOriginalitySubject[];
}
interface QualityIntent { mode:"CONVERSION"|"INFORMATION"; requiredConversionSteps:number; ctaRequired:boolean; }
const CATEGORY_QUALITY_INTENTS:Record<string,QualityIntent>={
  "b2b-product":{mode:"CONVERSION",requiredConversionSteps:2,ctaRequired:true},
  editorial:{mode:"INFORMATION",requiredConversionSteps:0,ctaRequired:false},
  "premium-consumer":{mode:"CONVERSION",requiredConversionSteps:2,ctaRequired:true},
  "motion-heavy":{mode:"CONVERSION",requiredConversionSteps:2,ctaRequired:true},
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
  return{state:reasons.length===0?"PASS":"FAIL",threshold,maxReferenceSimilarity:reference?.similarity??0,maxCorpusSimilarity:corpusMatch?.similarity??0,nearestReference:reference?.id??null,nearestCorpus:corpusMatch?.id??null,maxVisualReferenceSimilarity:0,maxVisualCorpusSimilarity:0,nearestVisualReference:null,nearestVisualCorpus:null,reasons};
}
export function auditOrderedGraphOriginality(graph:CompletePageGraph,references:readonly OrderedOriginalitySubject[]=[],corpus:readonly OrderedOriginalitySubject[]=[],threshold=.82):OriginalityAudit{
  const signature=pageGraphStructureSignature(graph).split("|");
  const nearest=(subjects:readonly OrderedOriginalitySubject[])=>subjects.map((subject)=>({id:subject.id,similarity:orderedTokenSimilarity(signature,pageGraphStructureSignature(subject.graph).split("|"))})).sort((left,right)=>right.similarity-left.similarity||left.id.localeCompare(right.id))[0]??null;
  const reference=nearest(references);const corpusMatch=nearest(corpus);const reasons:string[]=[];
  if(reference&&reference.similarity>=threshold)reasons.push(`reference-ordered-structure-too-close:${reference.id}:${reference.similarity.toFixed(3)}>=${threshold.toFixed(3)}`);
  if(corpusMatch&&corpusMatch.similarity>=threshold)reasons.push(`corpus-ordered-structure-too-close:${corpusMatch.id}:${corpusMatch.similarity.toFixed(3)}>=${threshold.toFixed(3)}`);
  return{state:reasons.length===0?"PASS":"FAIL",threshold,maxReferenceSimilarity:reference?.similarity??0,maxCorpusSimilarity:corpusMatch?.similarity??0,nearestReference:reference?.id??null,nearestCorpus:corpusMatch?.id??null,maxVisualReferenceSimilarity:0,maxVisualCorpusSimilarity:0,nearestVisualReference:null,nearestVisualCorpus:null,reasons};
}
function evaluateDesignQualityModel(graph:CompletePageGraph,viewport:QualityViewport,threshold:number,originalityReferences:readonly OriginalitySubject[]|readonly OrderedOriginalitySubject[],originalityCorpus:readonly OriginalitySubject[]|readonly OrderedOriginalitySubject[],originalitySimilarityThreshold:number,observation:DesignQualityBrowserObservation|null,tokenMatch:RuntimeTokenMatch|null,visualReferences:readonly VisualOriginalitySubject[],visualCorpus:readonly VisualOriginalitySubject[],version:"v2"|"v3"):DesignQualityScorecard|DesignQualityScorecardV3{
  const kinds=graph.nodes.map((node)=>node.kind);
  const layouts=graph.nodes.map((node)=>node.responsive[viewport].layout);
  const renderers=graph.nodes.map((node)=>node.mediaHook.renderer);
  const engines=graph.nodes.map((node)=>node.motionHook.engine);
  const intent=qualityIntent(graph);
  const validAction=observation?.computed.actionTargets.some((target)=>target.visible&&target.width>=44&&target.height>=44)??false;
  const motionSettled=observation?.computed.motionStates.every((state)=>state==="CLEANED"||state==="VISIBLE_NO_MOTION")??false;
  const penalties:string[]=[];
  const repeatedKinds=duplicates(kinds);if(repeatedKinds>1)penalties.push("repetitive-section-template");
  const gpuCount=renderers.filter((renderer)=>renderer==="pixi"||renderer==="three").length;if(gpuCount>2)penalties.push("gratuitous-gpu-complexity");
  const animatedRatio=engines.filter((engine)=>engine!=="none").length/Math.max(1,engines.length);if(animatedRatio>0.95)penalties.push("motion-applied-to-nearly-every-section");
  if(intent.mode==="CONVERSION"&&graph.conversionPath.length<intent.requiredConversionSteps)penalties.push("weak-conversion-path");
  if(intent.ctaRequired&&!kinds.includes("cta"))penalties.push("required-cta-missing");
  const originalityAudit=version==="v3"?auditOrderedGraphOriginality(graph,originalityReferences as readonly OrderedOriginalitySubject[],originalityCorpus as readonly OrderedOriginalitySubject[],originalitySimilarityThreshold):auditGraphOriginality(graph.signature,originalityReferences as readonly OriginalitySubject[],originalityCorpus as readonly OriginalitySubject[],originalitySimilarityThreshold);
  if(version==="v3"&&originalityCorpus.length===0)originalityAudit.reasons.push("ordered-structural-originality-corpus-absent");
  if(version==="v3"&&visualCorpus.length===0)originalityAudit.reasons.push("calibrated-visual-originality-corpus-absent");
  const visualSimilarity=version==="v3"?calibratedVisualSimilarity:visualObservationSimilarity;
  const nearestVisual=(subjects:readonly VisualOriginalitySubject[])=>observation?subjects.map((subject)=>({id:subject.id,similarity:visualSimilarity(observation,subject.observation)})).sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id))[0]??null:null;
  const visualReference=nearestVisual(visualReferences);const visualCorpusMatch=nearestVisual(visualCorpus);
  originalityAudit.maxVisualReferenceSimilarity=visualReference?.similarity??0;originalityAudit.maxVisualCorpusSimilarity=visualCorpusMatch?.similarity??0;originalityAudit.nearestVisualReference=visualReference?.id??null;originalityAudit.nearestVisualCorpus=visualCorpusMatch?.id??null;
  if(visualReference&&visualReference.similarity>=originalitySimilarityThreshold)originalityAudit.reasons.push(`reference-visual-too-close:${visualReference.id}:${visualReference.similarity.toFixed(3)}>=${originalitySimilarityThreshold.toFixed(3)}`);
  if(visualCorpusMatch&&visualCorpusMatch.similarity>=originalitySimilarityThreshold)originalityAudit.reasons.push(`corpus-visual-too-close:${visualCorpusMatch.id}:${visualCorpusMatch.similarity.toFixed(3)}>=${originalitySimilarityThreshold.toFixed(3)}`);
  originalityAudit.state=originalityAudit.reasons.length===0?"PASS":"FAIL";
  if(originalityAudit.state==="FAIL")penalties.push(...originalityAudit.reasons);
  if(!observation)penalties.push("browser-quality-observation-absent");
  else{
    if(observation.category!==graph.category||observation.viewport!==viewport)penalties.push("browser-quality-observation-identity-mismatch");
    if(observation.accessibility.seriousCriticalViolationCount>0)penalties.push("serious-critical-accessibility-violation");
    if(!observation.computed.contentBudgetPass)penalties.push("runtime-content-budget-overflow");
    if(observation.computed.overflowX)penalties.push("runtime-horizontal-overflow");
    if(observation.computed.h1Count!==1)penalties.push("runtime-heading-hierarchy-invalid");
    if(intent.ctaRequired&&!validAction)penalties.push("required-cta-action-not-observed");
    if(!motionSettled)penalties.push("motion-runtime-not-settled");
    if(visualCorpus.length===0)penalties.push("visual-originality-corpus-absent");
  }
  if(!tokenMatch)penalties.push("runtime-token-evidence-absent");else if(tokenMatch.state!=="PASS")penalties.push(...tokenMatch.mismatches.map((entry)=>`runtime-token-drift:${entry}`));
  const layoutVariety=new Set(layouts).size;
  const rendererVariety=new Set(renderers).size;
  const sectionVariety=new Set(kinds).size;
  const originalityDistance=Math.min(1-originalityAudit.maxReferenceSimilarity,1-originalityAudit.maxCorpusSimilarity,1-originalityAudit.maxVisualReferenceSimilarity,1-originalityAudit.maxVisualCorpusSimilarity);
  const progression=intent.mode==="INFORMATION"?informationProgressionCount(graph):graph.conversionPath.length;
  const headingRatio=observation&&observation.computed.medianH2Px>0?observation.computed.h1Px/observation.computed.medianH2Px:0;
  const heightMean=observation?observation.computed.sectionHeights.reduce((sum,value)=>sum+value,0)/Math.max(1,observation.computed.sectionHeights.length):0;
  const heightVariance=observation?observation.computed.sectionHeights.reduce((sum,value)=>sum+(value-heightMean)**2,0)/Math.max(1,observation.computed.sectionHeights.length):0;
  const heightCv=heightMean>0?Math.sqrt(heightVariance)/heightMean:0;
  const ctaClarity=intent.ctaRequired?clamp((validAction?65:10)+Math.min(25,graph.conversionPath.length*8)):clamp(82+Math.min(12,progression*2));
  const observedLayoutVariety=observation?new Set(observation.computed.layouts).size:0;
  const maxVisualSimilarity=Math.max(originalityAudit.maxVisualReferenceSimilarity,originalityAudit.maxVisualCorpusSimilarity);
  const dimensions:DesignQualityDimensions={
    hierarchy:observation?clamp((observation.computed.h1Count===1?45:0)+(observation.computed.h2Count>=Math.max(1,observation.computed.sectionCount-2)?25:10)+(headingRatio>=1.35&&headingRatio<=4?25:5)):0,
    composition:observation?clamp((observation.computed.overflowX?0:30)+Math.min(20,observation.computed.distinctSectionBackgrounds*10)+Math.min(20,observedLayoutVariety*7)+Math.min(15,observation.pixels.luminanceSpan*100)+Math.min(15,observation.pixels.colorEntropy*8)-repeatedKinds*5):0,
    rhythm:observation?clamp(72+Math.min(18,sectionVariety*2)+(heightCv>=0.08&&heightCv<=1.2?10:-15)):0,
    density:observation?clamp((observation.computed.contentBudgetPass?50:0)+(heightMean>=180&&heightMean<=900?25:10)+(viewport==="mobile"?observation.computed.renderedColumns.every((columns)=>columns===1)?25:0:25)):0,
    ctaClarity,
    responsiveCoherence:observation?clamp((graph.nodes.every((node)=>node.responsive.semanticOrder==="DOM_STABLE")?40:0)+(observation.computed.overflowX?0:30)+(viewport==="mobile"?observation.computed.renderedColumns.every((columns)=>columns===1)?30:0:Math.max(...observation.computed.renderedColumns)>=2?30:15)):0,
    mediaRestraint:observation?clamp(94-gpuCount*8-Math.max(0,observation.computed.mediaStages-Math.ceil(graph.nodes.length*.6))*8):0,
    motionRestraint:observation?clamp((observation.computed.motionStates.every((state)=>state==="CLEANED"||state==="VISIBLE_NO_MOTION")?94:45)-Math.max(0,animatedRatio-.8)*60):0,
    differentiation:observation?clamp((1-maxVisualSimilarity)*180+observedLayoutVariety*7+rendererVariety*5):0,
    originality:observation?clamp(originalityDistance*120-repeatedKinds*8):0
  };
  const values=Object.values(dimensions);const score=clamp(values.reduce((sum,value)=>sum+value,0)/values.length-penalties.length*3);
  const observationIdentityPass=Boolean(observation&&observation.category===graph.category&&observation.viewport===viewport&&/^[a-f0-9]{64}$/.test(observation.screenshot.sha256)&&observation.accessibility.seriousCriticalViolationCount===0&&!observation.computed.overflowX&&observation.computed.contentBudgetPass&&observation.computed.h1Count===1&&(!intent.ctaRequired||validAction)&&motionSettled);
  const measurementState:"PASS"|"FAIL"|"ABSENT"=!observation?"ABSENT":observationIdentityPass&&tokenMatch?.state==="PASS"?"PASS":"FAIL";
  const card={category:graph.category,viewport,graphSignature:graph.signature,threshold,score,overall:score>=threshold&&originalityAudit.state==="PASS"&&measurementState==="PASS"?"PASS" as const:"FAIL" as const,dimensions,penalties,originalityAudit,measurement:{state:measurementState,observationSchema:observation?.schema??null,screenshotSha256:observation?.screenshot.sha256??null,tokenMatch},intent};
  return version==="v3"?{schema:"website-design-compiler/design-quality-eval/v3",...card,methods:{scoreModel:"runtime-evidence-weighted/v3",structuralSimilarity:"ordered-page-graph/v1",visualSimilarity:"calibrated-visual/v1"}}:{schema:"website-design-compiler/design-quality-eval/v2",...card};
}
export function evaluateDesignQuality(graph:CompletePageGraph,viewport:QualityViewport,threshold=78,originalityReferences:readonly OriginalitySubject[]=[],originalityCorpus:readonly OriginalitySubject[]=[],originalitySimilarityThreshold=0.82,observation:DesignQualityBrowserObservation|null=null,tokenMatch:RuntimeTokenMatch|null=null,visualReferences:readonly VisualOriginalitySubject[]=[],visualCorpus:readonly VisualOriginalitySubject[]=[]):DesignQualityScorecard{
  return evaluateDesignQualityModel(graph,viewport,threshold,originalityReferences,originalityCorpus,originalitySimilarityThreshold,observation,tokenMatch,visualReferences,visualCorpus,"v2") as DesignQualityScorecard;
}
export function evaluateDesignQualityV3(graph:CompletePageGraph,viewport:QualityViewport,evidence:DesignQualityV3Evidence={}):DesignQualityScorecardV3{
  const threshold=evidence.premiumQualityThreshold??78;
  const originalityThreshold=evidence.originalitySimilarityThreshold??.82;
  if(threshold<78)throw new Error(`v3 premium quality threshold cannot be lower than 78: ${threshold}`);
  if(originalityThreshold<.82)throw new Error(`v3 originality similarity threshold cannot be lower than 0.82: ${originalityThreshold}`);
  return evaluateDesignQualityModel(graph,viewport,threshold,evidence.structuralReferences??[],evidence.structuralCorpus??[],originalityThreshold,evidence.observation??null,evidence.tokenMatch??null,evidence.visualReferences??[],evidence.visualCorpus??[],"v3") as DesignQualityScorecardV3;
}
