import type { Config, Field, Slot } from "@puckeditor/core";
import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";
import { GovernedSection } from "@/components/sections/governed-section";
import { SECTION_CONTRACTS, SECTION_KINDS, type SectionFieldContract, type SectionKind } from "../../../../src/section-grammar";

type StudioProps = {
  ButtonBlock: { label: string; intent: "primary" | "secondary" };
  StatusPanelBlock: { state: "loading" | "empty" | "error" | "success"; title: string; message: string };
  Section: { surfaceToken: "surface-default" | "surface-muted"; content: Slot };
  RichSectionBlock: { kind:SectionKind; variant:string; fields:Record<string,unknown>; provenance:Record<string,string>; tokenRef?:"semantic-design-tokens/v2" };
};

function fieldFor(contract:SectionFieldContract):Field {
  if(contract.type==="number")return{type:"number"};
  if(contract.type==="rich-text")return{type:"textarea"};
  if(contract.type==="link")return{type:"object",objectFields:{label:{type:"text"},href:{type:"text"}}};
  if(contract.type==="items")return{type:"array",arrayFields:{value:{type:"text"}},defaultItemProps:{value:"Evidence-backed item"}};
  if(contract.type==="media")return{type:"object",objectFields:{assetId:{type:"text"},alt:{type:"text"}}};
  return(contract.maxLength??0)>120?{type:"textarea"}:{type:"text"};
}
function fieldsFor(kind:SectionKind):Record<string,Field>{return Object.fromEntries(Object.entries(SECTION_CONTRACTS[kind].fields).map(([name,contract])=>[name,fieldFor(contract)]));}
function provenanceFieldsFor(kind:SectionKind):Record<string,Field>{return Object.fromEntries(Object.entries(SECTION_CONTRACTS[kind].fields).filter(([,contract])=>contract.provenanceRequired).map(([name])=>[name,{type:"text"} satisfies Field]));}
function textValue(value:unknown):string|undefined{return typeof value==="string"?value:undefined;}
function itemValues(value:unknown):string[]{if(!Array.isArray(value))return[];return value.map((entry)=>typeof entry==="string"?entry:entry&&typeof entry==="object"&&"value" in entry?String((entry as{value:unknown}).value):"").filter(Boolean);}

export const studioConfig: Config<StudioProps> = {
  root: {
    fields: { pageTitle:{type:"text",label:"Page title"}, surfaceToken:{type:"select",label:"Surface token",options:[{label:"Default",value:"surface-default"},{label:"Muted",value:"surface-muted"}]} },
    defaultProps:{pageTitle:"Governed authoring page",surfaceToken:"surface-default"},
    render:({children,pageTitle,surfaceToken})=><main data-authoring-root="true" data-surface-token={surfaceToken} aria-label={pageTitle}>{children}</main>
  },
  components: {
    ButtonBlock:{label:"Button",defaultProps:{label:"Continue",intent:"primary"},fields:{label:{type:"text",label:"Label"},intent:{type:"select",label:"Intent",options:[{label:"Primary",value:"primary"},{label:"Secondary",value:"secondary"}]}},render:({label,intent})=><Button intent={intent}>{label}</Button>},
    StatusPanelBlock:{label:"Status panel",defaultProps:{state:"success",title:"Status",message:"Governed content is available."},fields:{state:{type:"select",label:"State",options:[{label:"Loading",value:"loading"},{label:"Empty",value:"empty"},{label:"Error",value:"error"},{label:"Success",value:"success"}]},title:{type:"text",label:"Title"},message:{type:"textarea",label:"Message"}},render:({state,title,message})=><StatusPanel state={state} title={title} message={message}/>},
    Section:{label:"Section",defaultProps:{surfaceToken:"surface-default",content:[]},fields:{surfaceToken:{type:"select",label:"Surface token",options:[{label:"Default",value:"surface-default"},{label:"Muted",value:"surface-muted"}]},content:{type:"slot",allow:["ButtonBlock","StatusPanelBlock","RichSectionBlock"]}},render:({surfaceToken,content:Content})=><section data-authoring-section="true" data-surface-token={surfaceToken}><Content allow={["ButtonBlock","StatusPanelBlock","RichSectionBlock"]}/></section>},
    RichSectionBlock:{
      label:"Governed rich section",
      defaultProps:{kind:"hero",variant:"text-first",fields:{headline:"Governed section",body:"Claim-safe content",primaryAction:{label:"Action",href:"#"}},provenance:{headline:"authoring:user",body:"authoring:user",primaryAction:"authoring:user"},tokenRef:"semantic-design-tokens/v2"},
      fields:{kind:{type:"select",label:"Section kind",options:SECTION_KINDS.map((kind)=>({label:kind,value:kind}))},variant:{type:"select",label:"Variant",options:SECTION_CONTRACTS.hero.variants.map((variant)=>({label:variant,value:variant}))},fields:{type:"object",objectFields:fieldsFor("hero")},provenance:{type:"object",objectFields:provenanceFieldsFor("hero")}},
      resolveFields:(data)=>{const kind=SECTION_KINDS.includes(data.props.kind)?data.props.kind:"hero";return{kind:{type:"select",label:"Section kind",options:SECTION_KINDS.map((entry)=>({label:entry,value:entry}))},variant:{type:"select",label:"Variant",options:SECTION_CONTRACTS[kind].variants.map((variant)=>({label:variant,value:variant}))},fields:{type:"object",objectFields:fieldsFor(kind)},provenance:{type:"object",objectFields:provenanceFieldsFor(kind)}};},
      render:({kind,variant,fields})=><GovernedSection kind={kind} variant={variant} heading={textValue(fields.heading)??textValue(fields.headline)} body={textValue(fields.body)??textValue(fields.quote)} items={itemValues(fields.items)}/>
    }
  }
};
