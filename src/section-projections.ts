import { SECTION_CONTRACTS, SECTION_KINDS, type SectionFieldContract, type SectionKind } from "./section-grammar.js";

export type ProjectionFieldType = "text" | "textarea" | "number" | "items" | "media" | "link";
export interface ProjectionField { name:string; type:ProjectionFieldType; required:boolean; provenanceRequired:boolean; maxLength?:number; }
export interface GovernedSectionVariantStory { variant:string; exportName:string; storyId:string; }
export interface GovernedSectionProjection { kind:SectionKind; authoringType:string; payloadSlug:string; storyId:string; variantStories:GovernedSectionVariantStory[]; variants:string[]; fields:ProjectionField[]; claimPolicy:"CLAIM_SAFE"|"EVIDENCE_REQUIRED"; }

function mapField(name:string, field:SectionFieldContract):ProjectionField {
  const type:ProjectionFieldType = field.type === "rich-text" ? "textarea" : field.type;
  return { name, type, required:field.required, provenanceRequired:field.provenanceRequired, ...(field.maxLength === undefined ? {} : {maxLength:field.maxLength}) };
}

function storyIdFor(kind:SectionKind):string {
  const exportId = kind === "graphics-2d-stage" ? "graphics-2-d-stage" : kind === "graphics-3d-stage" ? "graphics-3-d-stage" : kind;
  return `governed-sections-section--${exportId}`;
}

function exportNameFor(value:string):string {
  return value.split("-").map((part)=>`${part.slice(0,1).toUpperCase()}${part.slice(1)}`).join("");
}

function variantStoriesFor(kind:SectionKind,variants:readonly string[]):GovernedSectionVariantStory[] {
  const baseStoryId=storyIdFor(kind);
  const baseExportName=exportNameFor(kind);
  return variants.map((variant,index)=>({
    variant,
    exportName:index===0?baseExportName:`${baseExportName}${exportNameFor(variant)}`,
    storyId:index===0?baseStoryId:`${baseStoryId}-${variant}`
  }));
}

export function projectSectionContracts():GovernedSectionProjection[] {
  return SECTION_KINDS.map((kind) => {
    const contract=SECTION_CONTRACTS[kind];
    return {
      kind,
      authoringType:`Section:${kind}`,
      payloadSlug:`section-${kind}`,
      storyId:storyIdFor(kind),
      variantStories:variantStoriesFor(kind,contract.variants),
      variants:[...contract.variants],
      fields:Object.entries(contract.fields).map(([name,field])=>mapField(name,field)),
      claimPolicy:contract.claimPolicy
    };
  });
}

export function projectionDriftErrors(projections=projectSectionContracts()):string[] {
  const errors:string[]=[];
  const byKind=new Map(projections.map((entry)=>[entry.kind,entry]));
  for(const kind of SECTION_KINDS){
    const projection=byKind.get(kind);
    if(!projection){errors.push(`missing projection for ${kind}`);continue;}
    const canonical=SECTION_CONTRACTS[kind];
    if(projection.variants.join("|")!==canonical.variants.join("|")) errors.push(`variant drift for ${kind}`);
    const canonicalFields=Object.keys(canonical.fields).sort().join("|");
    const projectedFields=projection.fields.map((field)=>field.name).sort().join("|");
    if(canonicalFields!==projectedFields) errors.push(`field drift for ${kind}`);
    if(projection.claimPolicy!==canonical.claimPolicy) errors.push(`claim policy drift for ${kind}`);
    if(projection.storyId!==storyIdFor(kind)) errors.push(`storybook identity drift for ${kind}`);
    const canonicalVariantStories=variantStoriesFor(kind,canonical.variants);
    if(JSON.stringify(projection.variantStories)!==JSON.stringify(canonicalVariantStories)) errors.push(`storybook variant drift for ${kind}`);
  }
  for(const projection of projections) if(!SECTION_KINDS.includes(projection.kind)) errors.push(`unknown projected section ${projection.kind}`);
  return errors;
}
