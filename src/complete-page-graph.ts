import type { SectionInstance, SectionKind } from "./section-grammar";
import type { SectionPageFixture } from "./section-page-fixtures";
import { compileResponsiveSectionPolicy, type ResponsiveSectionPolicy } from "./responsive-composition";
import { compileMotionChoreography, type ChoreographyEffect } from "./motion-choreography";
import { compileMediaOrchestration, type MediaDecision } from "./media-orchestration";

export type PageGraphReadiness="READY"|"NEEDS_INPUT";
export interface CompletePageNode {
  id:string;
  kind:SectionKind;
  variant:string;
  section:SectionInstance;
  tokenRef:"semantic-design-tokens/v2";
  responsive:ResponsiveSectionPolicy;
  motionHook:ChoreographyEffect;
  mediaHook:MediaDecision;
  semanticIndex:number;
}
export interface CompletePageGraph {
  schema:"website-design-compiler/page-graph/v2";
  category:string;
  route:"/";
  readiness:PageGraphReadiness;
  missingEvidence:string[];
  semanticOrder:string[];
  conversionPath:string[];
  nodes:CompletePageNode[];
  sharedChrome:{navigationId:string;footerId:string;consistencyKey:string};
  contracts:{arbitraryMarkupAllowed:false;semanticOrderOwner:"PAGE_GRAPH";designTokenSchema:"semantic-design-tokens/v2"};
  signature:string;
}

function requiredEvidenceMissing(section:SectionInstance):string[]{
  const missing:string[]=[];
  for(const key of Object.keys(section.props)) if(!section.provenance[key]) missing.push(`${section.id}.${key}`);
  return missing;
}
function conversionPath(sections:SectionInstance[]):string[]{
  const preferred=new Set<SectionKind>(["hero","feature-grid","proof-cloud","comparison","pricing","product-showcase","cta"]);
  return sections.filter((section)=>preferred.has(section.kind)).map((section)=>section.id);
}
export function compileCompletePageGraph(page:SectionPageFixture):CompletePageGraph{
  const motion=compileMotionChoreography(page);
  const media=compileMediaOrchestration(page);
  const missingEvidence=page.sections.flatMap(requiredEvidenceMissing);
  const nodes=page.sections.map((section,index):CompletePageNode=>({
    id:section.id,
    kind:section.kind,
    variant:section.variant,
    section,
    tokenRef:"semantic-design-tokens/v2",
    responsive:compileResponsiveSectionPolicy(section.kind),
    motionHook:motion.effects[index]!,
    mediaHook:media.decisions[index]!,
    semanticIndex:index
  }));
  const navigation=nodes.find((node)=>node.kind==="navigation");
  const footer=nodes.find((node)=>node.kind==="footer");
  if(!navigation||!footer) throw new Error(`${page.category}: complete page requires navigation and footer`);
  const semanticOrder=nodes.map((node)=>node.id);
  return{
    schema:"website-design-compiler/page-graph/v2",
    category:page.category,
    route:"/",
    readiness:missingEvidence.length===0?"READY":"NEEDS_INPUT",
    missingEvidence,
    semanticOrder,
    conversionPath:conversionPath(page.sections),
    nodes,
    sharedChrome:{navigationId:navigation.id,footerId:footer.id,consistencyKey:`${navigation.kind}|${footer.kind}|semantic-design-tokens/v2`},
    contracts:{arbitraryMarkupAllowed:false,semanticOrderOwner:"PAGE_GRAPH",designTokenSchema:"semantic-design-tokens/v2"},
    signature:nodes.map((node)=>`${node.kind}:${node.variant}:${node.responsive.mobile.layout}:${node.mediaHook.renderer}:${node.motionHook.engine}`).join("|")
  };
}
export function validateCompletePageGraph(graph:CompletePageGraph):string[]{
  const errors:string[]=[];
  if(graph.nodes.length<5)errors.push("complete page has fewer than five governed sections");
  if(graph.semanticOrder.join("|")!==graph.nodes.map((node)=>node.id).join("|"))errors.push("semantic order drifted from node order");
  if(graph.nodes.some((node,index)=>node.semanticIndex!==index))errors.push("semantic indices are not contiguous");
  if(graph.nodes.some((node)=>node.tokenRef!==graph.contracts.designTokenSchema))errors.push("section token identity drift");
  if(graph.nodes.some((node)=>node.responsive.semanticOrder!=="DOM_STABLE"))errors.push("responsive policy does not preserve semantic DOM order");
  if(graph.nodes.some((node)=>node.motionHook.sectionId!==node.id))errors.push("motion hook identity drift");
  if(graph.nodes.some((node)=>node.mediaHook.sectionId!==node.id))errors.push("media hook identity drift");
  if(graph.readiness==="READY"&&graph.missingEvidence.length>0)errors.push("READY graph contains missing evidence");
  if(graph.readiness==="NEEDS_INPUT"&&graph.missingEvidence.length===0)errors.push("NEEDS_INPUT graph has no named missing evidence");
  if(graph.contracts.arbitraryMarkupAllowed!==false)errors.push("arbitrary markup escape hatch enabled");
  return errors;
}
