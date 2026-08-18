import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, type Block, type CollectionConfig, type Field } from "payload";
import { SECTION_CONTRACTS, SECTION_KINDS, type SectionFieldContract, type SectionKind } from "./section-grammar.js";
import { validateAuthoringData, type AuthoringComponentData, type AuthoringData } from "./puck-authoring.js";
import { validateCompletePageGraph, type CompletePageGraph } from "./complete-page-graph.js";

export const PAYLOAD_VERSION="3.86.0" as const;export const CMS_LOCALES=["en","zh-TW"] as const;export const PAYLOAD_DEPLOYMENT_POLICY={developmentSchemaSync:"PUSH_ALLOWED",productionSchemaSync:"MIGRATIONS_REQUIRED",productionCredentialSource:"ENVIRONMENT_ONLY"} as const;
const authenticated=({req}:{req:{user?:unknown}})=>Boolean(req.user);

export const ButtonBlock:Block={slug:"button",interfaceName:"GovernedButtonBlock",fields:[{name:"componentId",type:"text",required:true},{name:"label",type:"text",required:true,localized:true},{name:"intent",type:"select",required:true,options:["primary","secondary"]}]};
export const StatusPanelBlock:Block={slug:"status-panel",interfaceName:"GovernedStatusPanelBlock",fields:[{name:"componentId",type:"text",required:true},{name:"state",type:"select",required:true,options:["loading","empty","error","success"]},{name:"title",type:"text",required:true,localized:true},{name:"message",type:"textarea",required:true,localized:true}]};
export const SectionBlock:Block={slug:"section",interfaceName:"GovernedSectionBlock",fields:[{name:"componentId",type:"text",required:true},{name:"surfaceToken",type:"select",required:true,options:["surface-default","surface-muted"]},{name:"content",type:"blocks",required:true,blocks:[ButtonBlock,StatusPanelBlock],maxRows:24}]};

function pascal(value:string):string{return value.split("-").map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join("");}
function payloadField(name:string,contract:SectionFieldContract):Field{
  if(contract.type==="number")return{name,type:"number",required:contract.required};
  if(contract.type==="items"||contract.type==="media")return{name,type:"json",required:contract.required};
  if(contract.type==="link")return{name,type:"group",required:contract.required,fields:[{name:"label",type:"text",required:true,localized:true},{name:"href",type:"text",required:true}]};
  if(contract.type==="rich-text"||((contract.maxLength??0)>120))return{name,type:"textarea",required:contract.required,localized:true};
  return{name,type:"text",required:contract.required,localized:true};
}
export function buildRichSectionPayloadBlocks():Block[]{
  return SECTION_KINDS.map((kind)=>{const contract=SECTION_CONTRACTS[kind];return{slug:`section-${kind}`,interfaceName:`Governed${pascal(kind)}SectionBlock`,fields:[{name:"componentId",type:"text",required:true},{name:"variant",type:"select",required:true,options:[...contract.variants]},...Object.entries(contract.fields).map(([name,field])=>payloadField(name,field)),{name:"provenance",type:"json",required:true},{name:"tokenRef",type:"text",required:true,defaultValue:"semantic-design-tokens/v2",admin:{readOnly:true}}]};});
}
export const RichSectionBlocks=buildRichSectionPayloadBlocks();

export const Users:CollectionConfig={slug:"cms-users",auth:{maxLoginAttempts:5,lockTime:10*60*1000},admin:{useAsTitle:"email"},access:{admin:authenticated,create:authenticated,read:authenticated,update:authenticated,delete:authenticated},fields:[{name:"role",type:"select",required:true,defaultValue:"editor",options:["editor","admin"]}]};
export const MediaAssets:CollectionConfig={slug:"media-assets",admin:{useAsTitle:"assetId"},access:{create:authenticated,read:authenticated,update:authenticated,delete:authenticated},fields:[{name:"assetId",type:"text",required:true,unique:true},{name:"mediaType",type:"select",required:true,options:["image","video","3d"]},{name:"sha256",type:"text",required:true},{name:"provenanceReceiptPath",type:"text",required:true},{name:"modelIdentity",type:"text",required:true},{name:"outputTermsSubject",type:"text",required:true},{name:"rightsState",type:"select",required:true,options:["ALLOW","REVIEW_REQUIRED","DENY"]}]};

export const Pages:CollectionConfig={slug:"pages",admin:{useAsTitle:"title"},versions:{drafts:{validate:true},maxPerDoc:50},access:{create:authenticated,update:authenticated,delete:authenticated,readVersions:authenticated,read:({req})=>req.user?true:{_status:{equals:"published"}}},fields:[{name:"slug",type:"text",required:true,unique:true},{name:"project",type:"text",required:true},{name:"title",type:"text",required:true,localized:true},{name:"surfaceToken",type:"select",required:true,defaultValue:"surface-default",options:["surface-default","surface-muted"]},{name:"layout",type:"blocks",required:true,localized:true,blocks:[ButtonBlock,StatusPanelBlock,SectionBlock,...RichSectionBlocks],maxRows:64,validate:(value)=>{try{const data=payloadLayoutToAuthoring(value,"Payload validation","surface-default");const result=validateAuthoringData(data);return result.overall==="PASS"?true:result.errors.join("; ");}catch(error){return error instanceof Error?error.message:"invalid governed Payload layout";}}},{name:"media",type:"relationship",relationTo:"media-assets",hasMany:true,required:false},{name:"compilerSchema",type:"text",required:true,defaultValue:"website-design-compiler/frontend-plan/v1"},{name:"authoringSchema",type:"text",required:true,defaultValue:"website-design-compiler/governed-authoring/v1"}]};

function validateStoredPageGraph(value:unknown):true|string{
  if(!isRecord(value)||value.schema!=="website-design-compiler/payload-page-graph/v2")return"compiled page graph schema is invalid";
  if(!Array.isArray(value.layout))return"compiled page graph layout must be an array";
  const nodes=value.layout.map((entry)=>{
    if(!isRecord(entry)||entry.blockType!=="governed-page-section")throw new Error("compiled page graph contains an ungoverned block");
    const {blockType:_,...node}=entry;
    return node;
  });
  const graph={schema:"website-design-compiler/page-graph/v2",category:value.category,route:value.route,readiness:value.readiness,semanticOrder:value.semanticOrder,conversionPath:value.conversionPath,sharedChrome:value.sharedChrome,contracts:value.contracts,signature:value.signature,missingEvidence:value.missingEvidence,nodes} as unknown as CompletePageGraph;
  const errors=validateCompletePageGraph(graph);
  return errors.length===0?true:errors.join("; ");
}

export const PageGraphs:CollectionConfig={slug:"compiled-pages",admin:{useAsTitle:"category"},versions:{drafts:{validate:true},maxPerDoc:50},access:{create:authenticated,update:authenticated,delete:authenticated,readVersions:authenticated,read:({req})=>req.user?true:{_status:{equals:"published"}}},fields:[{name:"category",type:"text",required:true,unique:true},{name:"route",type:"text",required:true},{name:"graph",type:"json",required:true,validate:(value)=>{try{return validateStoredPageGraph(value);}catch(error){return error instanceof Error?error.message:"invalid compiled page graph";}}},{name:"graphFingerprint",type:"text",required:true},{name:"editorNote",type:"text",required:false},{name:"compilerSchema",type:"text",required:true,defaultValue:"website-design-compiler/page-graph/v2"}]};

type PayloadBlock=Record<string,unknown>&{blockType:string};
function requireString(value:unknown,path:string):string{if(typeof value!=="string"||value.trim()==="")throw new Error(`${path} must be non-empty text`);return value;}
function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function richKindFromBlockType(blockType:string):SectionKind|null{const prefix="section-";if(!blockType.startsWith(prefix)||blockType==="section")return null;const kind=blockType.slice(prefix.length) as SectionKind;return SECTION_KINDS.includes(kind)?kind:null;}

function toPayloadBlock(component:AuthoringComponentData):PayloadBlock{
  if(component.type==="ButtonBlock")return{blockType:"button",componentId:component.props.id,label:component.props.label,intent:component.props.intent};
  if(component.type==="StatusPanelBlock")return{blockType:"status-panel",componentId:component.props.id,state:component.props.state,title:component.props.title,message:component.props.message};
  if(component.type==="RichSectionBlock"){
    const kind=component.props.kind as SectionKind;if(!SECTION_KINDS.includes(kind))throw new Error("RichSectionBlock kind is not governed");
    const fields=isRecord(component.props.fields)?component.props.fields:{};
    return{blockType:`section-${kind}`,componentId:component.props.id,variant:component.props.variant,...fields,provenance:component.props.provenance,tokenRef:component.props.tokenRef};
  }
  return{blockType:"section",componentId:component.props.id,surfaceToken:component.props.surfaceToken,content:(component.props.content as AuthoringComponentData[]).map(toPayloadBlock)};
}

function fromPayloadBlock(block:PayloadBlock):AuthoringComponentData{
  const id=requireString(block.componentId,"payload block componentId");
  if(block.blockType==="button")return{type:"ButtonBlock",props:{id,label:requireString(block.label,"button label"),intent:block.intent}};
  if(block.blockType==="status-panel")return{type:"StatusPanelBlock",props:{id,state:block.state,title:requireString(block.title,"status title"),message:requireString(block.message,"status message")}};
  if(block.blockType==="section"){if(!Array.isArray(block.content))throw new Error("section content must be a block array");return{type:"Section",props:{id,surfaceToken:block.surfaceToken,content:block.content.map((entry)=>{if(!entry||typeof entry!=="object"||Array.isArray(entry)||typeof(entry as Record<string,unknown>).blockType!=="string")throw new Error("section child is not a governed Payload block");return fromPayloadBlock(entry as PayloadBlock);})}};}
  const kind=richKindFromBlockType(block.blockType);
  if(kind){const contract=SECTION_CONTRACTS[kind];const fields:Record<string,unknown>={};for(const name of Object.keys(contract.fields))if(block[name]!==undefined)fields[name]=block[name];return{type:"RichSectionBlock",props:{id,kind,variant:block.variant,fields,provenance:block.provenance,tokenRef:block.tokenRef??"semantic-design-tokens/v2"}};}
  throw new Error(`Payload block type ${block.blockType} is not governed`);
}

export function authoringToPayloadLayout(data:AuthoringData):PayloadBlock[]{const validation=validateAuthoringData(data);if(validation.overall!=="PASS")throw new Error(`authoring data failed validation: ${validation.errors.join("; ")}`);return data.content.map(toPayloadBlock);}
export function payloadLayoutToAuthoring(layout:unknown,pageTitle:string,surfaceToken:"surface-default"|"surface-muted"):AuthoringData{if(!Array.isArray(layout))throw new Error("Payload layout must be an array");const content=layout.map((entry)=>{if(!entry||typeof entry!=="object"||Array.isArray(entry)||typeof(entry as Record<string,unknown>).blockType!=="string")throw new Error("Payload layout entry is not a governed block");return fromPayloadBlock(entry as PayloadBlock);});const data:AuthoringData={content,root:{props:{pageTitle,surfaceToken}}};const validation=validateAuthoringData(data);if(validation.overall!=="PASS")throw new Error(`Payload layout drifted from authoring schema: ${validation.errors.join("; ")}`);return data;}
export function createPayloadConfig(options:{databaseUrl:string;secret:string}){if(!options.secret||options.secret.length<16)throw new Error("Payload secret must be supplied by private runtime state");const developmentPush=process.env.NODE_ENV!=="production";return buildConfig({secret:options.secret,admin:{user:Users.slug},collections:[Users,Pages,PageGraphs,MediaAssets],localization:{locales:[...CMS_LOCALES],defaultLocale:"en",fallback:true},db:sqliteAdapter({client:{url:options.databaseUrl},push:developmentPush,blocksAsJSON:true,wal:true}),typescript:{autoGenerate:false}});}
