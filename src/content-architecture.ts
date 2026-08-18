import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { compileInformationArchitecture, type IaSection } from "./information-architecture.js";
import { REQUIRED_CONTENT_SLOTS, sectionFieldForContentSlot } from "./section-content-projection.js";
import { validateAgainstSchema } from "./validate.js";

export type ContentSourceType = "observed_fact" | "user_supplied_claim" | "derived_copy" | "placeholder_required" | "forbidden_invention";
export type ContentFieldState = "READY" | "NEEDS_INPUT" | "FORBIDDEN";
export type ContentValue = string | string[];

export interface ContentFieldContract {
  slot: string;
  state: ContentFieldState;
  sourceType: ContentSourceType;
  value: ContentValue | null;
  publishable: boolean;
  provenance: string[];
  lengthBudget: { maxCharacters: number };
}

export interface SectionContentContract {
  sectionId: string;
  sectionType: string;
  messageGoal: string;
  audienceQuestion: string;
  ctaRole: "PRIMARY" | "SECONDARY" | "NONE";
  fallback: string;
  localePolicy: { sourceLocale: "en"; localizationReady: true };
  fields: ContentFieldContract[];
  quality: {
    forbiddenPhraseHits: string[];
    repeatedPublishableValues: string[];
  };
}

export interface ContentArchitecturePlan {
  schema: "website-design-compiler/content-architecture/v2";
  project: string;
  audience: string;
  objective: string;
  sections: SectionContentContract[];
  forbiddenInventions: string[];
  overall: "READY" | "NEEDS_INPUT";
}

const PLACEHOLDER_SLOTS = new Set([
  "feature-items",
  "proof-items",
  "story-beats",
  "body-content",
  "related-items"
]);

const FORBIDDEN_SLOTS = new Set([
  "customer-logos",
  "testimonials",
  "metrics",
  "pricing",
  "customer-names",
  "performance-claims"
]);

const EMPTY_MARKETING_PHRASES = [
  "game-changing",
  "best-in-class",
  "world-class",
  "revolutionary",
  "cutting-edge",
  "seamless"
];

const LIST_SLOTS = new Set(["feature-items", "proof-items", "related-items", "story-beats"]);

function maxCharactersFor(slot: string,sectionType:string): number {
  const governedMaximum=sectionFieldForContentSlot(sectionType,slot)?.maxLength;
  if(governedMaximum!==undefined)return governedMaximum;
  if (slot.includes("headline")) return 120;
  if (slot === "primary-action" || slot === "primary-action-label" || slot === "cta-label") return 36;
  if (slot.includes("name")) return 64;
  if (slot.includes("description") || slot.includes("proposition") || slot === "task") return 220;
  return 280;
}

function validContentValue(slot:string,value:unknown,maxCharacters:number):value is ContentValue{
  if(LIST_SLOTS.has(slot))return Array.isArray(value)&&value.length>0&&value.length<=12&&value.every((entry)=>typeof entry==="string"&&entry.trim().length>0&&entry.length<=maxCharacters);
  return typeof value==="string"&&value.trim().length>0&&value.length<=maxCharacters;
}

function safeSuppliedValue(slot: string, input: CompilerInput,section:IaSection,maxCharacters:number): ContentValue | null {
  const suppliedFields=input.contentEvidence?.source==="USER_SUPPLIED"?input.contentEvidence.sections[section.id]:undefined;
  if(suppliedFields&&Object.hasOwn(suppliedFields,slot)){
    const supplied=suppliedFields[slot];
    return validContentValue(slot,supplied,maxCharacters)?structuredClone(supplied):null;
  }
  if (slot === "brand-or-project-name" || slot === "project-name") return validContentValue(slot,input.project,maxCharacters)?input.project:null;
  if (
    input.briefSourceEvidence?.fields.objective.sourceExcerpt &&
    ((slot === "headline"&&section.type.startsWith("hero-")) || slot === "value-proposition" || slot === "product-description" || slot === "task" || slot === "dek")
  ) return validContentValue(slot,input.brief.objective,maxCharacters)?input.brief.objective:null;
  return null;
}

function provenanceFor(slot: string, input: CompilerInput,section:IaSection): string[] {
  if(input.contentEvidence?.source==="USER_SUPPLIED"&&input.contentEvidence.sections[section.id]?.[slot]!==undefined&&input.briefSourceEvidence)return[`brief-input:${input.briefSourceEvidence.inputSha256}#/contentEvidence/sections/${section.id}/${slot}`];
  if (slot === "brand-or-project-name" || slot === "project-name") return [`compiler.project:${input.project}`];
  if (input.briefSourceEvidence?.fields.objective.sourceExcerpt && ((slot === "headline"&&section.type.startsWith("hero-")) || slot === "value-proposition" || slot === "product-description" || slot === "task" || slot === "dek")) {
    return [`brief-input:${input.briefSourceEvidence.inputSha256}#objective`];
  }
  return [];
}

function audienceQuestion(section: IaSection, audience: string): string {
  return `What does ${audience} need to understand from ${section.id}?`;
}

function ctaRole(section: IaSection): "PRIMARY" | "SECONDARY" | "NONE" {
  if (section.id === "navigation" || section.id === "conversion") return "PRIMARY";
  if (section.id.includes("hero")) return "SECONDARY";
  return "NONE";
}

function fieldFor(slot: string, input: CompilerInput, section: IaSection, forbidden: Set<string>): ContentFieldContract {
  const maxCharacters = maxCharactersFor(slot,section.type);
  if (forbidden.has(slot) || FORBIDDEN_SLOTS.has(slot)) {
    return {
      slot,
      state: "FORBIDDEN",
      sourceType: "forbidden_invention",
      value: null,
      publishable: false,
      provenance: [`policy.forbidden:${slot}`],
      lengthBudget: { maxCharacters }
    };
  }

  const value = safeSuppliedValue(slot, input,section,maxCharacters);
  if (!value&&PLACEHOLDER_SLOTS.has(slot)) {
    return {
      slot,
      state: "NEEDS_INPUT",
      sourceType: "placeholder_required",
      value: null,
      publishable: false,
      provenance: [`ia.section:${section.id}`],
      lengthBudget: { maxCharacters }
    };
  }

  if (!value) {
    return {
      slot,
      state: "NEEDS_INPUT",
      sourceType: "placeholder_required",
      value: null,
      publishable: false,
      provenance: provenanceFor(slot, input,section),
      lengthBudget: { maxCharacters }
    };
  }

  return {
    slot,
    state: "READY",
    sourceType: "user_supplied_claim",
    value,
    publishable: true,
    provenance: provenanceFor(slot, input,section),
    lengthBudget: { maxCharacters }
  };
}

function qualityFor(fields: ContentFieldContract[]): SectionContentContract["quality"] {
  const publishable = fields.filter((field) => field.publishable && field.value).flatMap((field) => Array.isArray(field.value)?field.value:[field.value!]);
  const forbiddenPhraseHits = EMPTY_MARKETING_PHRASES.filter((phrase) => publishable.some((value) => value.toLowerCase().includes(phrase)));
  const counts = new Map<string, number>();
  for (const value of publishable) counts.set(value, (counts.get(value) ?? 0) + 1);
  const repeatedPublishableValues = [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
  return { forbiddenPhraseHits, repeatedPublishableValues };
}

export function validateSectionContentContract(contract:SectionContentContract):string[]{
  const errors:string[]=[];
  const expectedSlots=REQUIRED_CONTENT_SLOTS[contract.sectionType];
  const actualSlots=contract.fields.map((field)=>field.slot);
  if(!expectedSlots)errors.push(`unknown section type ${contract.sectionType}`);
  else if(JSON.stringify([...actualSlots].sort())!==JSON.stringify([...expectedSlots].sort()))errors.push("field slot projection drift");
  if(new Set(actualSlots).size!==actualSlots.length)errors.push("duplicate content field slot");
  for(const field of contract.fields){
    const expectedMaximum=maxCharactersFor(field.slot,contract.sectionType);
    if(field.lengthBudget.maxCharacters!==expectedMaximum)errors.push(`${field.slot}: length budget drift`);
    const validValue=validContentValue(field.slot,field.value,expectedMaximum);
    if(field.state==="READY"&&(!validValue||!field.publishable||field.provenance.length===0))errors.push(`${field.slot}: invalid READY field`);
    if(field.state!=="READY"&&(field.value!==null||field.publishable))errors.push(`${field.slot}: non-READY field is publishable`);
  }
  const expectedQuality=qualityFor(contract.fields);
  if(JSON.stringify(contract.quality)!==JSON.stringify(expectedQuality))errors.push("quality projection drift");
  return errors;
}

export function compileContentArchitecture(input: CompilerInput): ContentArchitecturePlan {
  const ia = compileInformationArchitecture(input);
  if(input.contentEvidence){
    if(input.contentEvidence.schema!=="website-design-compiler/content-evidence/v1"||input.contentEvidence.source!=="USER_SUPPLIED")throw new Error("content evidence identity is invalid");
    if(!input.briefSourceEvidence)throw new Error("content evidence requires exact brief source evidence");
    const sectionsById=new Map(ia.sections.map((section)=>[section.id,section]));
    for(const [sectionId,fields] of Object.entries(input.contentEvidence.sections)){
      const section=sectionsById.get(sectionId);if(!section)throw new Error(`content evidence references unknown section ${sectionId}`);
      for(const slot of Object.keys(fields))if(!section.requiredContent.includes(slot))throw new Error(`content evidence references unknown slot ${sectionId}.${slot}`);
    }
  }
  const forbidden = new Set(ia.forbiddenInventions);
  const sections = ia.sections.map<SectionContentContract>((section) => {
    const fields = section.requiredContent.map((slot) => fieldFor(slot, input, section, forbidden));
    return {
      sectionId: section.id,
      sectionType: section.type,
      messageGoal: section.purpose,
      audienceQuestion: audienceQuestion(section, input.brief.audience),
      ctaRole: ctaRole(section),
      fallback: section.fallback,
      localePolicy: { sourceLocale: "en", localizationReady: true },
      fields,
      quality: qualityFor(fields)
    };
  });

  const qualityFailure = sections.some((section) => section.quality.forbiddenPhraseHits.length > 0 || section.quality.repeatedPublishableValues.length > 0);
  const needsInput = sections.some((section) => section.fields.some((field) => field.state === "NEEDS_INPUT"));
  const contractErrors=sections.flatMap((section)=>validateSectionContentContract(section).map((error)=>`${section.sectionId}: ${error}`));
  if(contractErrors.length>0)throw new Error(`invalid content architecture: ${contractErrors.join("; ")}`);
  return {
    schema: "website-design-compiler/content-architecture/v2",
    project: input.project,
    audience: input.brief.audience,
    objective: input.brief.objective,
    sections,
    forbiddenInventions: ia.forbiddenInventions,
    overall: qualityFailure || needsInput ? "NEEDS_INPUT" : "READY"
  };
}

export async function writeContentArchitecturePlan(input: CompilerInput, outputDirectory: string): Promise<string> {
  const plan = compileContentArchitecture(input);
  await validateAgainstSchema(plan, "content-architecture-v2.schema.json");
  const directory = join(outputDirectory, "content-architecture");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "content-architecture.json");
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}
