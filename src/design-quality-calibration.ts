import type { CompletePageGraph } from "./complete-page-graph";
import { visualFingerprint, type DesignQualityBrowserObservation } from "./design-quality-observation";

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const mean=(values:readonly number[])=>values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);

export function calibrationReorder<T>(values:readonly T[]):T[]{
  if(values.length<2)return[...values];
  const offset=Math.floor(values.length/2);
  return[...values.slice(offset),...values.slice(0,offset)];
}

export function orderedTokenSimilarity(left:readonly string[],right:readonly string[]):number{
  if(left.join("|")===right.join("|"))return 1;
  const rows=Array.from({length:left.length+1},()=>Array<number>(right.length+1).fill(0));
  for(let i=1;i<=left.length;i+=1)for(let j=1;j<=right.length;j+=1)rows[i]![j]=left[i-1]===right[j-1]?rows[i-1]![j-1]!+1:Math.max(rows[i-1]![j]!,rows[i]![j-1]!);
  return rows[left.length]![right.length]!/Math.max(left.length,right.length,1);
}

export function pageGraphStructureSignature(graph:CompletePageGraph):string{return[
  ...graph.nodes.map((node)=>`${node.kind}:${node.variant}:${node.responsive.mobile.layout}.${node.responsive.mobile.columns}>${node.responsive.tablet.layout}.${node.responsive.tablet.columns}>${node.responsive.desktop.layout}.${node.responsive.desktop.columns}:${node.mediaHook.renderer}:${node.motionHook.engine}`),
  `conversion:${graph.conversionPath.map((id)=>graph.semanticOrder.indexOf(id)).join(",")}`
].join("|");}

function vectorSimilarity(left:readonly number[],right:readonly number[]):number{return clamp01(1-mean(left.map((value,index)=>Math.abs(value-(right[index]??0)))));}

export function calibratedVisualSimilarity(left:DesignQualityBrowserObservation,right:DesignQualityBrowserObservation):number{
  if(JSON.stringify(left)===JSON.stringify(right))return 1;
  const pixelSimilarity=vectorSimilarity(visualFingerprint(left).slice(0,11),visualFingerprint(right).slice(0,11));
  const tokenNames=["--wdc-color-background","--wdc-color-surface","--wdc-color-accent","--wdc-font-display","--wdc-font-body","--wdc-font-display-weight","--wdc-radius-lg","--wdc-elevation-high","--wdc-media-treatment","--wdc-media-gradient-policy"];
  const comparableTokens=tokenNames.filter((name)=>Boolean(left.computed.cssTokens[name]&&right.computed.cssTokens[name]));
  const tokenSimilarity=mean(comparableTokens.map((name)=>left.computed.cssTokens[name]===right.computed.cssTokens[name]?1:0));
  const composition=(observation:DesignQualityBrowserObservation)=>observation.computed.layouts.map((layout,index)=>{
    const widthRatio=observation.computed.sectionWidths[index]!/Math.max(1,observation.computed.pageWidth);
    return`${layout}:${observation.computed.renderedColumns[index]??1}:${Math.round(widthRatio*10)}`;
  });
  const leftComposition=composition(left);const rightComposition=composition(right);
  const compositionSimilarity=orderedTokenSimilarity(leftComposition,rightComposition);
  const heightProfile=(observation:DesignQualityBrowserObservation)=>observation.computed.sectionHeights.map((height)=>clamp01(height/Math.max(1,observation.computed.pageHeight)));
  const rhythmSimilarity=mean([vectorSimilarity(heightProfile(left),heightProfile(right)),1-Math.min(1,Math.abs(left.computed.mediaStages/Math.max(1,left.computed.sectionCount)-right.computed.mediaStages/Math.max(1,right.computed.sectionCount))),1-Math.min(1,Math.abs(left.computed.distinctSectionBackgrounds-right.computed.distinctSectionBackgrounds)/4)]);
  return clamp01(pixelSimilarity*.25+tokenSimilarity*.20+compositionSimilarity*.40+rhythmSimilarity*.15);
}
