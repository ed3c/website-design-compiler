import { SECTION_KINDS, validateSectionInstance, type SectionInstance, type SectionKind } from "./section-grammar";

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
  components: Array<{ id: string; component: "button" | "status-panel"; props: Record<string, unknown> }>;
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
  hasOnlyKeys(props,["id","surfaceToken","content"],`${path}.props`,errors);if(!SURFACE_TOKENS.has(String(props.surfaceToken)))errors.push(`${path}.props.surfaceToken must reference an approved design token`);if(!Array.isArray(props.content)){errors.push(`${path}.props.content must be a slot component array`);return;}props.content.forEach((entry,index)=>{if(isRecord(entry)&&entry.type==="Section")errors.push(`${path}.props.content[${index}] cannot nest Section inside Section`);validateComponent(entry,`${path}.props.content[${index}]`,errors,depth+1);});
}

export function validateAuthoringData(value:unknown):AuthoringValidation{
  const errors:string[]=[];if(!isRecord(value))return{overall:"FAIL",errors:["authoring data must be an object"]};hasOnlyKeys(value,["content","root"],"data",errors);if(!Array.isArray(value.content))errors.push("data.content must be an array");else value.content.forEach((entry,index)=>validateComponent(entry,`data.content[${index}]`,errors));if(!isRecord(value.root))errors.push("data.root must be an object");else{hasOnlyKeys(value.root,["props"],"data.root",errors);if(value.root.props!==undefined){if(!isRecord(value.root.props))errors.push("data.root.props must be an object");else{hasOnlyKeys(value.root.props,["pageTitle","surfaceToken"],"data.root.props",errors);if(value.root.props.pageTitle!==undefined&&typeof value.root.props.pageTitle!=="string")errors.push("data.root.props.pageTitle must be text");if(value.root.props.surfaceToken!==undefined&&!SURFACE_TOKENS.has(String(value.root.props.surfaceToken)))errors.push("data.root.props.surfaceToken must reference an approved design token");}}}return{overall:errors.length===0?"PASS":"FAIL",errors};
}

export function importFrontendPlan(plan:FrontendPlanLike):AuthoringData{
  if(plan.schema!=="website-design-compiler/frontend-plan/v1"||plan.renderer!=="nextjs-registry"||plan.arbitraryMarkupAllowed!==false)throw new Error("frontend plan is not eligible for governed Puck import");
  const content:AuthoringComponentData[]=plan.components.map((node)=>{if(node.component==="button"){const intent=String(node.props.intent??"primary");const label=node.props.children;if(!BUTTON_INTENTS.has(intent)||typeof label!=="string")throw new Error(`invalid governed button node ${node.id}`);return{type:"ButtonBlock",props:{id:node.id,label,intent}};}if(node.component==="status-panel"){const state=String(node.props.state);if(!STATUS_STATES.has(state)||typeof node.props.title!=="string"||typeof node.props.message!=="string")throw new Error(`invalid governed status node ${node.id}`);return{type:"StatusPanelBlock",props:{id:node.id,state,title:node.props.title,message:node.props.message}};}throw new Error(`unsupported frontend component ${(node as{component:string}).component}`);});
  const data:AuthoringData={content,root:{props:{pageTitle:plan.project,surfaceToken:"surface-default"}}};const validation=validateAuthoringData(data);if(validation.overall!=="PASS")throw new Error(`imported authoring data failed validation: ${validation.errors.join("; ")}`);return data;
}

export function exportFrontendPlan(data:AuthoringData,project:string):FrontendPlanLike{
  const validation=validateAuthoringData(data);if(validation.overall!=="PASS")throw new Error(`authoring data failed validation: ${validation.errors.join("; ")}`);const flattened=data.content.flatMap((entry)=>entry.type==="Section"?(entry.props.content as AuthoringComponentData[]):[entry]);
  return{schema:"website-design-compiler/frontend-plan/v1",project,renderer:"nextjs-registry",arbitraryMarkupAllowed:false,components:flattened.map((entry)=>{if(entry.type==="ButtonBlock")return{id:entry.props.id,component:"button" as const,props:{intent:entry.props.intent,children:entry.props.label}};if(entry.type==="StatusPanelBlock")return{id:entry.props.id,component:"status-panel" as const,props:{state:entry.props.state,title:entry.props.title,message:entry.props.message}};if(entry.type==="RichSectionBlock")throw new Error("rich sections require complete-page-graph/v2 export, not frontend-plan/v1");throw new Error("nested Section cannot be exported as a production registry node");})};
}
