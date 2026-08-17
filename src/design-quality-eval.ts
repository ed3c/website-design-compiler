import type { CompletePageGraph } from "./complete-page-graph.js";

export type QualityViewport="mobile"|"desktop";
export interface DesignQualityDimensions { hierarchy:number; composition:number; rhythm:number; density:number; ctaClarity:number; responsiveCoherence:number; mediaRestraint:number; motionRestraint:number; differentiation:number; originality:number; }
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
}
const clamp=(value:number)=>Math.max(0,Math.min(100,Math.round(value)));
function duplicates(values:string[]):number{return values.length-new Set(values).size;}
export function evaluateDesignQuality(graph:CompletePageGraph,viewport:QualityViewport,threshold=78):DesignQualityScorecard{
  const kinds=graph.nodes.map((node)=>node.kind);
  const layouts=graph.nodes.map((node)=>node.responsive[viewport].layout);
  const renderers=graph.nodes.map((node)=>node.mediaHook.renderer);
  const engines=graph.nodes.map((node)=>node.motionHook.engine);
  const penalties:string[]=[];
  const repeatedKinds=duplicates(kinds);if(repeatedKinds>1)penalties.push("repetitive-section-template");
  const gpuCount=renderers.filter((renderer)=>renderer==="pixi"||renderer==="three").length;if(gpuCount>2)penalties.push("gratuitous-gpu-complexity");
  const animatedRatio=engines.filter((engine)=>engine!=="none").length/Math.max(1,engines.length);if(animatedRatio>0.95)penalties.push("motion-applied-to-nearly-every-section");
  if(graph.conversionPath.length<2)penalties.push("weak-conversion-path");
  const layoutVariety=new Set(layouts).size;
  const rendererVariety=new Set(renderers).size;
  const sectionVariety=new Set(kinds).size;
  const dimensions:DesignQualityDimensions={
    hierarchy:clamp(70+Math.min(20,graph.conversionPath.length*5)-(graph.nodes[0]?.kind==="navigation"?0:25)),
    composition:clamp(62+layoutVariety*9-repeatedKinds*8),
    rhythm:clamp(68+Math.min(20,sectionVariety*3)-repeatedKinds*7),
    density:clamp(viewport==="mobile"?graph.nodes.every((node)=>node.responsive.mobile.columns===1||node.responsive.mobile.layout==="stage")?90:55:82),
    ctaClarity:clamp(62+graph.conversionPath.length*7),
    responsiveCoherence:clamp(graph.nodes.every((node)=>node.responsive.semanticOrder==="DOM_STABLE")?92:35),
    mediaRestraint:clamp(92-gpuCount*8-Math.max(0,renderers.filter((renderer)=>renderer!=="dom").length-Math.ceil(graph.nodes.length*0.6))*7),
    motionRestraint:clamp(92-Math.max(0,animatedRatio-0.8)*60),
    differentiation:clamp(64+layoutVariety*7+rendererVariety*5),
    originality:clamp(80-repeatedKinds*10)
  };
  const values=Object.values(dimensions);const score=clamp(values.reduce((sum,value)=>sum+value,0)/values.length-penalties.length*3);
  return{schema:"website-design-compiler/design-quality-eval/v2",category:graph.category,viewport,graphSignature:graph.signature,threshold,score,overall:score>=threshold?"PASS":"FAIL",dimensions,penalties};
}
