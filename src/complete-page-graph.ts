import { SECTION_CONTRACTS, validateSectionInstance, type SectionInstance, type SectionKind } from "./section-grammar";
import type { SectionPageSource } from "./section-page-source.js";
import { validateSectionContentContract, type SectionContentContract } from "./content-contract";
import { compileResponsiveSectionPolicy, type ResponsiveSectionPolicy } from "./responsive-composition";
import { compileMotionChoreography, type ChoreographyEffect } from "./motion-choreography";
import { compileMediaOrchestration, type MediaDecision } from "./media-orchestration";
import { FIELD_SLOTS, SECTION_TYPE_TO_KIND, sectionFieldNameForContentSlot } from "./section-content-projection";
import type { VisualDirectionDimensions } from "./visual-direction-search.js";

export type PageGraphReadiness="READY"|"NEEDS_INPUT";
export interface PageGraphSourceBinding{
  mode:"FIXTURE"|"PRODUCTION";
  artifacts:Record<string,string>;
}
export interface PageGraphCompilationInput extends SectionPageSource{
  project?:string;
  route?:string;
  source?:PageGraphSourceBinding;
  contentContracts?:SectionContentContract[];
  visualDirection?:VisualDirectionDimensions;
}
export interface CompletePageNode {
  id:string;
  kind:SectionKind;
  variant:string;
  section:SectionInstance;
  tokenRef:"semantic-design-tokens/v2";
  responsive:ResponsiveSectionPolicy;
  motionHook:ChoreographyEffect;
  mediaHook:MediaDecision;
  contentContract:SectionContentContract|null;
  semanticIndex:number;
}
export interface CompletePageGraph {
  schema:"website-design-compiler/page-graph/v2";
  project:string;
  category:string;
  route:string;
  source:PageGraphSourceBinding;
  readiness:PageGraphReadiness;
  missingEvidence:string[];
  semanticOrder:string[];
  conversionPath:string[];
  nodes:CompletePageNode[];
  sharedChrome:{navigationId:string;footerId:string;consistencyKey:string};
  contracts:{arbitraryMarkupAllowed:false;semanticOrderOwner:"PAGE_GRAPH";designTokenSchema:"semantic-design-tokens/v2"};
  signature:string;
}

const PRODUCTION_SOURCE_KEYS=["compilerInput","informationArchitecture","contentArchitecture","visualDirectionSearch","semanticDesignTokens","designSystem","pageArchitecture"] as const;
function stableIdentity(value:unknown):string{
  const text=JSON.stringify(value);let output="";
  for(let seed=0;seed<8;seed++){let hash=(2166136261^seed)>>>0;for(let index=0;index<text.length;index++){hash^=text.charCodeAt(index);hash=Math.imul(hash,16777619)>>>0;}output+=hash.toString(16).padStart(8,"0");}
  return output;
}
export function completePageGraphSignature(graph:Omit<CompletePageGraph,"signature">):string{return stableIdentity(graph);}
function normalizeRoute(route:string):string{const value=route.trim();if(!value.startsWith("/")||value.includes("//")||value.includes("?")||value.includes("#"))throw new Error(`invalid governed page route: ${route}`);return value.length>1&&value.endsWith("/")?value.slice(0,-1):value;}
function requiredEvidenceMissing(section:SectionInstance):string[]{
  const missing:string[]=[];
  for(const key of Object.keys(section.props)) if(!section.provenance[key]) missing.push(`${section.id}.${key}`);
  for(const [key,field] of Object.entries(SECTION_CONTRACTS[section.kind].fields))if(field.required&&(section.props[key]===undefined||section.props[key]===null||section.props[key]===""))missing.push(`${section.id}.${key}`);
  return missing;
}
function sourceFor(page:PageGraphCompilationInput):PageGraphSourceBinding{return page.source??{mode:"FIXTURE",artifacts:{sectionPageFixture:stableIdentity({category:page.category,sections:page.sections})}};}
function contentEvidenceMissing(sectionId:string,contract:SectionContentContract|null):string[]{
  if(!contract)return[];
  const fields=contract.fields.filter((field)=>field.state!=="READY"||!field.publishable||!field.value||field.provenance.length===0).map((field)=>`${sectionId}.content.${field.slot}`);
  return contract.quality.forbiddenPhraseHits.length>0||contract.quality.repeatedPublishableValues.length>0?[...fields,`${sectionId}.content.quality`]:fields;
}
function expectedMissingEvidence(nodes:readonly CompletePageNode[]):string[]{return[...new Set(nodes.flatMap((node)=>[...requiredEvidenceMissing(node.section),...contentEvidenceMissing(node.id,node.contentContract)]))].sort();}
function conversionPath(sections:SectionInstance[]):string[]{
  const preferred=new Set<SectionKind>(["hero","feature-grid","proof-cloud","comparison","pricing","product-showcase","cta"]);
  return sections.filter((section)=>preferred.has(section.kind)).map((section)=>section.id);
}
export function compileCompletePageGraph(page:PageGraphCompilationInput):CompletePageGraph{
  const motion=compileMotionChoreography(page);
  const media=compileMediaOrchestration(page);
  const contentBySection=new Map((page.contentContracts??[]).map((contract)=>[contract.sectionId,contract]));
  const missingEvidence=[...new Set(page.sections.flatMap((section)=>[...requiredEvidenceMissing(section),...contentEvidenceMissing(section.id,contentBySection.get(section.id)??null)]))].sort();
  const source=sourceFor(page);
  const route=normalizeRoute(page.route??"/");
  const nodes=page.sections.map((section,index):CompletePageNode=>({
    id:section.id,
    kind:section.kind,
    variant:section.variant,
    section,
    tokenRef:"semantic-design-tokens/v2",
    responsive:compileResponsiveSectionPolicy(section.kind,page.visualDirection),
    motionHook:motion.effects[index]!,
    mediaHook:media.decisions[index]!,
    contentContract:structuredClone(contentBySection.get(section.id)??null),
    semanticIndex:index
  }));
  const navigation=nodes.find((node)=>node.kind==="navigation");
  const footer=nodes.find((node)=>node.kind==="footer");
  if(!navigation||!footer) throw new Error(`${page.category}: complete page requires navigation and footer`);
  const semanticOrder=nodes.map((node)=>node.id);
  const graph:Omit<CompletePageGraph,"signature">={
    schema:"website-design-compiler/page-graph/v2",
    project:page.project??page.category,
    category:page.category,
    route,
    source:structuredClone(source),
    readiness:missingEvidence.length===0?"READY":"NEEDS_INPUT",
    missingEvidence,
    semanticOrder,
    conversionPath:conversionPath(page.sections),
    nodes,
    sharedChrome:{navigationId:navigation.id,footerId:footer.id,consistencyKey:`${navigation.kind}|${footer.kind}|semantic-design-tokens/v2`},
    contracts:{arbitraryMarkupAllowed:false,semanticOrderOwner:"PAGE_GRAPH",designTokenSchema:"semantic-design-tokens/v2"}
  };
  return{...graph,signature:completePageGraphSignature(graph)};
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
  const expectedMissing=expectedMissingEvidence(graph.nodes);
  if(JSON.stringify(graph.missingEvidence)!==JSON.stringify(expectedMissing))errors.push("missing evidence projection drift");
  const expectedReadiness:PageGraphReadiness=expectedMissing.length===0?"READY":"NEEDS_INPUT";
  if(graph.readiness!==expectedReadiness)errors.push(`readiness drift: expected ${expectedReadiness}`);
  for(const node of graph.nodes){
    const structuralErrors=validateSectionInstance(node.section).filter((error)=>{
      const missing=error.match(/^missing (?:required field|provenance for) (.+)$/)?.[1];
      return !missing||!graph.missingEvidence.includes(`${node.id}.${missing}`);
    });
    errors.push(...structuralErrors.map((error)=>`${node.id}: ${error}`));
    if(node.contentContract){
      errors.push(...validateSectionContentContract(node.contentContract).map((error)=>`${node.id}.content: ${error}`));
      if(node.contentContract.sectionId!==node.id)errors.push(`${node.id}.content: section identity drift`);
      if(SECTION_TYPE_TO_KIND[node.contentContract.sectionType]!==node.kind)errors.push(`${node.id}.content: section type/kind drift`);
      for(const [prop,slots] of Object.entries(FIELD_SLOTS[node.kind]??{})){
        if(node.section.props[prop]===undefined)continue;
        const sourceField=node.contentContract.fields.find((field)=>slots.includes(field.slot)&&sectionFieldNameForContentSlot(node.contentContract!.sectionType,field.slot)===prop);
        if(!sourceField||sourceField.state!=="READY"||!sourceField.publishable||sourceField.provenance.join("|")!==node.section.provenance[prop])errors.push(`${node.id}.content: ${prop} lacks exact READY field backing`);
      }
    }
    if(graph.source.mode==="PRODUCTION"&&!node.contentContract)errors.push(`${node.id}: production node lacks content contract`);
  }
  if(graph.readiness==="READY"&&graph.missingEvidence.length>0)errors.push("READY graph contains missing evidence");
  if(graph.readiness==="NEEDS_INPUT"&&graph.missingEvidence.length===0)errors.push("NEEDS_INPUT graph has no named missing evidence");
  if(graph.contracts.arbitraryMarkupAllowed!==false)errors.push("arbitrary markup escape hatch enabled");
  try{if(normalizeRoute(graph.route)!==graph.route)errors.push("page route is not normalized");}catch(error){errors.push(error instanceof Error?error.message:"invalid governed page route");}
  if(graph.source.mode==="PRODUCTION")for(const key of PRODUCTION_SOURCE_KEYS)if(!/^[a-f0-9]{64}$/.test(graph.source.artifacts[key]??""))errors.push(`production source artifact ${key} is absent or invalid`);
  if(graph.source.mode==="FIXTURE"&&!/^[a-f0-9]{64}$/.test(graph.source.artifacts.sectionPageFixture??""))errors.push("fixture source artifact identity is absent or invalid");
  const {signature:_,...unsigned}=graph;if(graph.signature!==completePageGraphSignature(unsigned))errors.push("page graph signature drift");
  return errors;
}
