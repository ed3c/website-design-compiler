import {
  SECTION_CONTRACTS,
  SECTION_KINDS,
  type SectionCompositionContract,
  type SectionFieldContract,
  type SectionKind
} from "./section-grammar";

export type ProjectionFieldType = "text" | "textarea" | "number" | "items" | "media" | "link";
export interface GovernedSectionVariantStory { variant:string; exportName:string; storyId:string; }

export interface ProjectionField {
  name: string;
  type: ProjectionFieldType;
  required: boolean;
  provenanceRequired: boolean;
  maxLength?: number;
}

export interface GovernedSectionProjection {
  kind: SectionKind;
  authoringType: "RichSectionBlock";
  payloadSlug: string;
  storyId: string;
  variantStories: GovernedSectionVariantStory[];
  variants: string[];
  fields: ProjectionField[];
  composition: SectionCompositionContract;
  rawMarkupAllowed: false;
  tokenOwnership: "semantic-design-tokens/v2";
  claimPolicy: "CLAIM_SAFE" | "EVIDENCE_REQUIRED";
}

function mapField(name: string, field: SectionFieldContract): ProjectionField {
  const type: ProjectionFieldType = field.type === "rich-text" ? "textarea" : field.type;
  return {
    name,
    type,
    required: field.required,
    provenanceRequired: field.provenanceRequired,
    ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength })
  };
}

function storyIdFor(kind: SectionKind): string {
  const exportId =
    kind === "graphics-2d-stage"
      ? "graphics-2-d-stage"
      : kind === "graphics-3d-stage"
        ? "graphics-3-d-stage"
        : kind;
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

export function projectSectionContracts(): GovernedSectionProjection[] {
  return SECTION_KINDS.map((kind) => {
    const contract = SECTION_CONTRACTS[kind];
    return {
      kind,
      authoringType: "RichSectionBlock",
      payloadSlug: `section-${kind}`,
      storyId: storyIdFor(kind),
      variantStories: variantStoriesFor(kind, contract.variants),
      variants: [...contract.variants],
      fields: Object.entries(contract.fields).map(([name, field]) => mapField(name, field)),
      composition: contract.composition,
      rawMarkupAllowed: contract.rawMarkupAllowed,
      tokenOwnership: contract.tokenOwnership,
      claimPolicy:contract.claimPolicy
    };
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function projectionDriftErrors(
  projections: readonly GovernedSectionProjection[] = projectSectionContracts()
): string[] {
  const errors: string[] = [];
  const counts = new Map<SectionKind, number>();
  for (const projection of projections) {
    if (!SECTION_KINDS.includes(projection.kind)) {
      errors.push(`unknown projected section ${projection.kind}`);
      continue;
    }
    counts.set(projection.kind, (counts.get(projection.kind) ?? 0) + 1);
  }

  for (const kind of SECTION_KINDS) {
    const count = counts.get(kind) ?? 0;
    if (count === 0) {
      errors.push(`missing projection for ${kind}`);
      continue;
    }
    if (count > 1) errors.push(`duplicate projection for ${kind}`);

    const projection = projections.find((entry) => entry.kind === kind)!;
    const canonical = SECTION_CONTRACTS[kind];
    const canonicalFields = Object.entries(canonical.fields).map(([name, field]) =>
      mapField(name, field)
    );
    if (!sameValue(projection.variants, canonical.variants)) {
      errors.push(`variant drift for ${kind}`);
    }
    if (!sameValue(projection.fields, canonicalFields)) {
      errors.push(`field drift for ${kind}`);
    }
    if (projection.authoringType !== "RichSectionBlock") {
      errors.push(`authoring identity drift for ${kind}`);
    }
    if (projection.payloadSlug !== `section-${kind}`) {
      errors.push(`payload identity drift for ${kind}`);
    }
    if (projection.storyId !== storyIdFor(kind)) {
      errors.push(`storybook identity drift for ${kind}`);
    }
    if (!sameValue(projection.variantStories, variantStoriesFor(kind, canonical.variants))) {
      errors.push(`storybook variant drift for ${kind}`);
    }
    if (projection.claimPolicy !== canonical.claimPolicy) {
      errors.push(`claim policy drift for ${kind}`);
    }
    if (projection.tokenOwnership !== canonical.tokenOwnership) {
      errors.push(`token ownership drift for ${kind}`);
    }
    if (projection.rawMarkupAllowed !== canonical.rawMarkupAllowed) {
      errors.push(`raw markup policy drift for ${kind}`);
    }
    if (!sameValue(projection.composition, canonical.composition)) {
      errors.push(`composition drift for ${kind}`);
    }
  }
  return errors;
}
