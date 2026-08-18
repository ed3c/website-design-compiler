import { REQUIRED_CONTENT_SLOTS, sectionFieldForContentSlot } from "./section-content-projection";

export type ContentSourceType="observed_fact"|"user_supplied_claim"|"derived_copy"|"placeholder_required"|"forbidden_invention";
export type ContentFieldState="READY"|"NEEDS_INPUT"|"FORBIDDEN";
export type ContentValue=string|string[];

export interface ContentFieldContract{
  slot:string;
  state:ContentFieldState;
  sourceType:ContentSourceType;
  value:ContentValue|null;
  publishable:boolean;
  provenance:string[];
  lengthBudget:{maxCharacters:number};
}

export interface SectionContentContract{
  sectionId:string;
  sectionType:string;
  messageGoal:string;
  audienceQuestion:string;
  ctaRole:"PRIMARY"|"SECONDARY"|"NONE";
  fallback:string;
  localePolicy:{sourceLocale:"en";localizationReady:true};
  fields:ContentFieldContract[];
  quality:{forbiddenPhraseHits:string[];repeatedPublishableValues:string[]};
}

const EMPTY_MARKETING_PHRASES=["game-changing","best-in-class","world-class","revolutionary","cutting-edge","seamless"];
const LIST_SLOTS=new Set(["feature-items","proof-items","related-items","story-beats"]);

export function maxCharactersForContentSlot(slot:string,sectionType:string):number{
  const governedMaximum=sectionFieldForContentSlot(sectionType,slot)?.maxLength;
  if(governedMaximum!==undefined)return governedMaximum;
  if(slot.includes("headline"))return 120;
  if(slot==="primary-action"||slot==="primary-action-label"||slot==="cta-label")return 36;
  if(slot.includes("name"))return 64;
  if(slot.includes("description")||slot.includes("proposition")||slot==="task")return 220;
  return 280;
}

export function validContentValue(slot:string,value:unknown,maxCharacters:number):value is ContentValue{
  if(LIST_SLOTS.has(slot))return Array.isArray(value)&&value.length>0&&value.length<=12&&value.every((entry)=>typeof entry==="string"&&entry.trim().length>0&&entry.length<=maxCharacters);
  return typeof value==="string"&&value.trim().length>0&&value.length<=maxCharacters;
}

export function qualityForContentFields(fields:ContentFieldContract[]):SectionContentContract["quality"]{
  const publishable=fields.filter((field)=>field.publishable&&field.value).flatMap((field)=>Array.isArray(field.value)?field.value:[field.value!]);
  const forbiddenPhraseHits=EMPTY_MARKETING_PHRASES.filter((phrase)=>publishable.some((value)=>value.toLowerCase().includes(phrase)));
  const counts=new Map<string,number>();for(const value of publishable)counts.set(value,(counts.get(value)??0)+1);
  const repeatedPublishableValues=[...counts.entries()].filter(([,count])=>count>1).map(([value])=>value);
  return{forbiddenPhraseHits,repeatedPublishableValues};
}

export function validateSectionContentContract(contract:SectionContentContract):string[]{
  const errors:string[]=[];
  const expectedSlots=REQUIRED_CONTENT_SLOTS[contract.sectionType];
  const actualSlots=contract.fields.map((field)=>field.slot);
  if(!expectedSlots)errors.push(`unknown section type ${contract.sectionType}`);
  else if(JSON.stringify([...actualSlots].sort())!==JSON.stringify([...expectedSlots].sort()))errors.push("field slot projection drift");
  if(new Set(actualSlots).size!==actualSlots.length)errors.push("duplicate content field slot");
  for(const field of contract.fields){
    const expectedMaximum=maxCharactersForContentSlot(field.slot,contract.sectionType);
    if(field.lengthBudget.maxCharacters!==expectedMaximum)errors.push(`${field.slot}: length budget drift`);
    const validValue=validContentValue(field.slot,field.value,expectedMaximum);
    if(field.state==="READY"&&(!validValue||!field.publishable||field.provenance.length===0))errors.push(`${field.slot}: invalid READY field`);
    if(field.state!=="READY"&&(field.value!==null||field.publishable))errors.push(`${field.slot}: non-READY field is publishable`);
  }
  if(JSON.stringify(contract.quality)!==JSON.stringify(qualityForContentFields(contract.fields)))errors.push("quality projection drift");
  return errors;
}
