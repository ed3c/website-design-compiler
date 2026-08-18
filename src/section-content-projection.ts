import { SECTION_CONTRACTS, type SectionFieldContract, type SectionKind } from "./section-grammar.js";

export const SECTION_TYPE_TO_KIND:Readonly<Record<string,SectionKind>>={
  navigation:"navigation",footer:"footer","hero-product":"hero","hero-editorial":"hero","hero-premium":"hero","hero-creative":"hero","hero-interactive":"hero",
  "feature-grid":"feature-grid",proof:"proof-cloud","cta-band":"cta","editorial-prose":"editorial-prose","related-content":"faq","product-showcase":"product-showcase",
  "narrative-sequence":"bento-grid","interactive-stage":"media-stage","graphics-2d-stage":"graphics-2d-stage","graphics-3d-stage":"graphics-3d-stage"
};

export const FIELD_SLOTS:Readonly<Partial<Record<SectionKind,Readonly<Record<string,readonly string[]>>>>>= {
  navigation:{brand:["brand-or-project-name"],action:["primary-action-label"]},
  hero:{headline:["headline"],body:["value-proposition","product-description","task","dek"],primaryAction:["primary-action"]},
  "feature-grid":{heading:["headline"],items:["feature-items"]},"bento-grid":{heading:["headline"],items:["story-beats"]},
  "proof-cloud":{items:["proof-items"]},cta:{headline:["cta-headline"],action:["cta-label"]},footer:{brand:["project-name"]},
  "editorial-prose":{heading:["headline"],body:["body-content"]},faq:{heading:["headline"],items:["related-items"]},
  "product-showcase":{heading:["headline"],body:["product-description"]},"media-stage":{description:["interaction-purpose"]},
  "graphics-2d-stage":{description:["scene-purpose"]},"graphics-3d-stage":{description:["scene-purpose"]}
};

export const REQUIRED_CONTENT_SLOTS:Readonly<Record<string,readonly string[]>>={
  navigation:["brand-or-project-name","primary-action-label"],footer:["project-name"],
  "hero-product":["headline","value-proposition","primary-action"],"hero-editorial":["headline","dek"],"hero-premium":["headline","value-proposition","primary-action"],"hero-creative":["headline","value-proposition","primary-action"],"hero-interactive":["headline","task","primary-action"],
  "feature-grid":["headline","feature-items"],proof:["proof-items"],"cta-band":["cta-headline","cta-label"],
  "editorial-prose":["body-content"],"related-content":["headline","related-items"],"product-showcase":["headline","product-description"],
  "narrative-sequence":["story-beats"],"interactive-stage":["interaction-purpose"],"graphics-2d-stage":["scene-purpose"],"graphics-3d-stage":["scene-purpose"]
};

export function sectionFieldForContentSlot(sectionType:string,slot:string):SectionFieldContract|undefined{
  const kind=SECTION_TYPE_TO_KIND[sectionType];
  if(!kind)return undefined;
  const fieldName=Object.entries(FIELD_SLOTS[kind]??{}).find(([,slots])=>slots.includes(slot))?.[0];
  return fieldName?SECTION_CONTRACTS[kind].fields[fieldName]:undefined;
}

export function sectionFieldNameForContentSlot(sectionType:string,slot:string):string|undefined{
  const kind=SECTION_TYPE_TO_KIND[sectionType];
  if(!kind)return undefined;
  return Object.entries(FIELD_SLOTS[kind]??{}).find(([,slots])=>slots.includes(slot))?.[0];
}
