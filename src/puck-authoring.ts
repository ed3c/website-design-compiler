import { SECTION_KINDS, validateSectionInstance, type SectionInstance, type SectionKind } from "./section-grammar";
import { validateCompletePageGraph, type CompletePageGraph, type CompletePageNode } from "./complete-page-graph";

export type GovernedAuthoringType = "ButtonBlock" | "StatusPanelBlock" | "Section" | "RichSectionBlock";

export interface AuthoringComponentData {
  type: GovernedAuthoringType;
  props: Record<string, unknown> & { id: string };
}

export interface AuthoringData {
  content: AuthoringComponentData[];
  root: { props?: { pageTitle?: string; surfaceToken?: "surface-default" | "surface-muted" } };
}

export interface FrontendPlanLike {
  schema: "website-design-compiler/frontend-plan/v1";
  project: string;
  renderer: "nextjs-registry";
  arbitraryMarkupAllowed: false;
  components: Array<
    | { id: string; component: "button"; props: Record<string, unknown> }
    | { id: string; component: "status-panel"; props: Record<string, unknown> }
    | { id: string; component: "rich-section"; props: SectionInstance }
  >;
}

export interface AuthoringValidation { overall: "PASS" | "FAIL"; errors: string[]; }
const BUTTON_INTENTS=new Set(["primary","secondary"]);const STATUS_STATES=new Set(["loading","empty","error","success"]);const SURFACE_TOKENS=new Set(["surface-default","surface-muted"]);const ALLOWED_TYPES=new Set<GovernedAuthoringType>(["ButtonBlock","StatusPanelBlock","Section","RichSectionBlock"]);
function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function hasOnlyKeys(value:Record<string,unknown>,allowed:readonly string[],path:string,errors:string[]):void{const allowedSet=new Set(allowed);for(const key of Object.keys(value))if(!allowedSet.has(key))errors.push(`${path}.${key} is not an approved prop`);}

function validateRichSection(props:Record<string,unknown>,path:string,errors:string[]):void{
  hasOnlyKeys(props,["id","kind","variant","fields","provenance","tokenRef"],path,errors);
  if(typeof props.kind!=="string"||!SECTION_KINDS.includes(props.kind as SectionKind)){errors.push(`${path}.kind is not a governed section kind`);return;}
  if(typeof props.variant!=="string")errors.push(`${path}.variant must be text`);
  if(!isRecord(props.fields))errors.push(`${path}.fields must be an object`);
  if(!isRecord(props.provenance))errors.push(`${path}.provenance must be an object`);
  if(props.tokenRef!=="semantic-design-tokens/v2")errors.push(`${path}.tokenRef must reference semantic-design-tokens/v2`);
  if(typeof props.variant==="string"&&isRecord(props.fields)&&isRecord(props.provenance)){
    const provenance:Record<string,string>={};for(const [key,value] of Object.entries(props.provenance))if(typeof value==="string")provenance[key]=value;else errors.push(`${path}.provenance.${key} must be text`);
    const instance:SectionInstance={id:String(props.id),kind:props.kind as SectionKind,variant:props.variant,props:props.fields,provenance,tokenRef:"semantic-design-tokens/v2"};
    for(const error of validateSectionInstance(instance))errors.push(`${path}: ${error}`);
  }
}

function validateComponent(value:unknown,path:string,errors:string[],depth=0):void{
  if(depth>8){errors.push(`${path} exceeds maximum nested authoring depth`);return;}
  if(!isRecord(value)){errors.push(`${path} must be an object`);return;}
  const type=value.type;const props=value.props;
  if(typeof type!=="string"||!ALLOWED_TYPES.has(type as GovernedAuthoringType)){errors.push(`${path}.type is not an approved governed component`);return;}
  if(!isRecord(props)||typeof props.id!=="string"||props.id.trim()===""){errors.push(`${path}.props.id must be a non-empty string`);return;}
  if(type==="ButtonBlock"){hasOnlyKeys(props,["id","label","intent"],`${path}.props`,errors);if(typeof props.label!=="string"||props.label.trim()==="")errors.push(`${path}.props.label must be non-empty text`);if(!BUTTON_INTENTS.has(String(props.intent)))errors.push(`${path}.props.intent must be a governed button intent`);return;}
  if(type==="StatusPanelBlock"){hasOnlyKeys(props,["id","state","title","message"],`${path}.props`,errors);if(!STATUS_STATES.has(String(props.state)))errors.push(`${path}.props.state must be a governed status state`);if(typeof props.title!=="string"||props.title.trim()==="")errors.push(`${path}.props.title must be non-empty text`);if(typeof props.message!=="string"||props.message.trim()==="")errors.push(`${path}.props.message must be non-empty text`);return;}
  if(type==="RichSectionBlock"){validateRichSection(props,`${path}.props`,errors);return;}
  hasOnlyKeys(props,["id","surfaceToken","content"],`${path}.props`,errors);if(!SURFACE_TOKENS.has(String(props.surfaceToken)))errors.push(`${path}.props.surfaceToken must reference an approved design token`);if(!Array.isArray(props.content)){errors.push(`${path}.props.content must be a slot component array`);return;}props.content.forEach((entry,index)=>{if(isRecord(entry)&&entry.type==="Section")errors.push(`${path}.props.content[${index}] cannot nest Section inside Section`);if(isRecord(entry)&&entry.type==="RichSectionBlock")errors.push(`${path}.props.content[${index}] RichSectionBlock must be placed at page root`);validateComponent(entry,`${path}.props.content[${index}]`,errors,depth+1);});
}

function validatePageGraphAuthoringData(value:Record<string,unknown>):AuthoringValidation{
  const errors:string[]=[];
  hasOnlyKeys(value,["schema","content","root"],"data",errors);
  if(value.schema!=="website-design-compiler/puck-page-graph/v2")errors.push("data.schema is not a supported Puck page graph");
  if(!Array.isArray(value.content))errors.push("data.content must be an array");
  if(!isRecord(value.root)||!isRecord(value.root.props))errors.push("data.root.props must be an object");
  if(errors.length>0)return{overall:"FAIL",errors};

  const root=value.root as {props:Record<string,unknown>};
  hasOnlyKeys(root,["props"],"data.root",errors);
  hasOnlyKeys(root.props,["category","route","readiness","semanticOrder","conversionPath","sharedChrome","contracts","signature","missingEvidence"],"data.root.props",errors);
  const nodes:CompletePageNode[]=[];
  (value.content as unknown[]).forEach((entry,index)=>{
    const path=`data.content[${index}]`;
    if(!isRecord(entry)){errors.push(`${path} must be an object`);return;}
    hasOnlyKeys(entry,["type","props"],path,errors);
    if(entry.type!=="GovernedPageSection"){errors.push(`${path}.type is not GovernedPageSection`);return;}
    if(!isRecord(entry.props)){errors.push(`${path}.props must be an object`);return;}
    hasOnlyKeys(entry.props,["id","kind","variant","section","tokenRef","responsive","motionHook","mediaHook","semanticIndex"],`${path}.props`,errors);
    if(!isRecord(entry.props.section)){errors.push(`${path}.props.section must be an object`);return;}
    const node=entry.props as unknown as CompletePageNode;
    if(node.id!==node.section.id)errors.push(`${path}.props.id drifted from section.id`);
    for(const error of validateSectionInstance(node.section))errors.push(`${path}.props.section: ${error}`);
    nodes.push(node);
  });
  if(errors.length>0)return{overall:"FAIL",errors};
  if(!Array.isArray(root.props.semanticOrder)||!Array.isArray(root.props.conversionPath)||!Array.isArray(root.props.missingEvidence))errors.push("data.root.props graph arrays are invalid");
  if(!isRecord(root.props.sharedChrome)||!isRecord(root.props.contracts))errors.push("data.root.props graph contracts are invalid");
  if(typeof root.props.category!=="string"||typeof root.props.route!=="string"||typeof root.props.signature!=="string")errors.push("data.root.props graph identity is invalid");
  if(root.props.readiness!=="READY"&&root.props.readiness!=="NEEDS_INPUT")errors.push("data.root.props.readiness is invalid");
  if(errors.length>0)return{overall:"FAIL",errors};

  const graph:CompletePageGraph={
    schema:"website-design-compiler/page-graph/v2",
    category:root.props.category as string,
    route:root.props.route as "/",
    readiness:root.props.readiness as CompletePageGraph["readiness"],
    missingEvidence:root.props.missingEvidence as string[],
    semanticOrder:root.props.semanticOrder as string[],
    conversionPath:root.props.conversionPath as string[],
    nodes,
    sharedChrome:root.props.sharedChrome as unknown as CompletePageGraph["sharedChrome"],
    contracts:root.props.contracts as unknown as CompletePageGraph["contracts"],
    signature:root.props.signature as string
  };
  errors.push(...validateCompletePageGraph(graph));
  return{overall:errors.length===0?"PASS":"FAIL",errors};
}

export function validateAuthoringData(value:unknown):AuthoringValidation{
  const errors:string[]=[];if(!isRecord(value))return{overall:"FAIL",errors:["authoring data must be an object"]};if(value.schema!==undefined)return validatePageGraphAuthoringData(value);hasOnlyKeys(value,["content","root"],"data",errors);if(!Array.isArray(value.content))errors.push("data.content must be an array");else value.content.forEach((entry,index)=>validateComponent(entry,`data.content[${index}]`,errors));if(!isRecord(value.root))errors.push("data.root must be an object");else{hasOnlyKeys(value.root,["props"],"data.root",errors);if(value.root.props!==undefined){if(!isRecord(value.root.props))errors.push("data.root.props must be an object");else{hasOnlyKeys(value.root.props,["pageTitle","surfaceToken"],"data.root.props",errors);if(value.root.props.pageTitle!==undefined&&typeof value.root.props.pageTitle!=="string")errors.push("data.root.props.pageTitle must be text");if(value.root.props.surfaceToken!==undefined&&!SURFACE_TOKENS.has(String(value.root.props.surfaceToken)))errors.push("data.root.props.surfaceToken must reference an approved design token");}}}return{overall:errors.length===0?"PASS":"FAIL",errors};
}

export function importFrontendPlan(plan:FrontendPlanLike):AuthoringData{
  if(plan.schema!=="website-design-compiler/frontend-plan/v1"||plan.renderer!=="nextjs-registry"||plan.arbitraryMarkupAllowed!==false)throw new Error("frontend plan is not eligible for governed Puck import");
  const content:AuthoringComponentData[]=plan.components.map((node)=>{if(node.component==="button"){const intent=String(node.props.intent??"primary");const label=node.props.children;if(!BUTTON_INTENTS.has(intent)||typeof label!=="string")throw new Error(`invalid governed button node ${node.id}`);return{type:"ButtonBlock",props:{id:node.id,label,intent}};}if(node.component==="status-panel"){const state=String(node.props.state);if(!STATUS_STATES.has(state)||typeof node.props.title!=="string"||typeof node.props.message!=="string")throw new Error(`invalid governed status node ${node.id}`);return{type:"StatusPanelBlock",props:{id:node.id,state,title:node.props.title,message:node.props.message}};}if(node.component==="rich-section"){const section=node.props as SectionInstance;const sectionErrors=validateSectionInstance(section);if(sectionErrors.length>0)throw new Error(`invalid governed rich section ${node.id}: ${sectionErrors.join("; ")}`);return{type:"RichSectionBlock",props:{id:section.id,kind:section.kind,variant:section.variant,fields:structuredClone(section.props),provenance:structuredClone(section.provenance),tokenRef:section.tokenRef}};}throw new Error(`unsupported frontend component ${(node as{component:string}).component}`);});
  const data:AuthoringData={content,root:{props:{pageTitle:plan.project,surfaceToken:"surface-default"}}};const validation=validateAuthoringData(data);if(validation.overall!=="PASS")throw new Error(`imported authoring data failed validation: ${validation.errors.join("; ")}`);return data;
}

export function exportFrontendPlan(data:AuthoringData,project:string):FrontendPlanLike{
  const validation=validateAuthoringData(data);if(validation.overall!=="PASS")throw new Error(`authoring data failed validation: ${validation.errors.join("; ")}`);const flattened=data.content.flatMap((entry)=>entry.type==="Section"?(entry.props.content as AuthoringComponentData[]):[entry]);
  return{schema:"website-design-compiler/frontend-plan/v1",project,renderer:"nextjs-registry",arbitraryMarkupAllowed:false,components:flattened.map((entry)=>{if(entry.type==="ButtonBlock")return{id:entry.props.id,component:"button" as const,props:{intent:entry.props.intent,children:entry.props.label}};if(entry.type==="StatusPanelBlock")return{id:entry.props.id,component:"status-panel" as const,props:{state:entry.props.state,title:entry.props.title,message:entry.props.message}};if(entry.type==="RichSectionBlock"){const section:SectionInstance={id:entry.props.id,kind:entry.props.kind as SectionKind,variant:String(entry.props.variant),props:structuredClone(entry.props.fields as Record<string,unknown>),provenance:structuredClone(entry.props.provenance as Record<string,string>),tokenRef:entry.props.tokenRef as "semantic-design-tokens/v2"};return{id:section.id,component:"rich-section" as const,props:section};}throw new Error("nested Section cannot be exported as a production registry node");})};
}
