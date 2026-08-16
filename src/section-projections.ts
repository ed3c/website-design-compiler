import { SECTION_CONTRACTS, SECTION_KINDS, type SectionFieldContract, type SectionKind } from "./section-grammar.js";

export type ProjectionFieldType = "text" | "textarea" | "number" | "items" | "media" | "link";
export interface ProjectionField { name:string; type:ProjectionFieldType; required:boolean; provenanceRequired:boolean; maxLength?:number; }
export interface GovernedSectionProjection { kind:SectionKind; authoringType:string; payloadSlug:string; storyId:string; variants:string[]; fields:ProjectionField[]; claimPolicy:"CLAIM_SAFE"|"EVIDENCE_REQUIRED"; }

function mapField(name:string, field:SectionFieldContract):ProjectionField {
  const type:ProjectionFieldType = field.type === "rich-text" ? "textarea" : field.type;
  return { name, type, required:field.required, provenanceRequired:field.provenanceRequired, ...(field.maxLength === undefined ? {} : {maxLength:field.maxLength}) };
}

export function projectSectionContracts():GovernedSectionProjection[] {
  return SECTION_KINDS.map((kind) => {
    const contract=SECTION_CONTRACTS[kind];
    return {
      kind,
      authoringType:`Section:${kind}`,
      payloadSlug:`section-${kind}`,
      storyId:`governed-section--${kind}`,
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
  }
  for(const projection of projections) if(!SECTION_KINDS.includes(projection.kind)) errors.push(`unknown projected section ${projection.kind}`);
  return errors;
}
