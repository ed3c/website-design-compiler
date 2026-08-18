import { SECTION_CONTRACTS, validateSectionInstance, type SectionFieldContract, type SectionInstance, type SectionKind } from "./section-grammar";

export const SECTION_PAGE_CATEGORIES = ["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"] as const;
export type SectionPageCategory=(typeof SECTION_PAGE_CATEGORIES)[number];
export interface SectionPageFixture { schema:"website-design-compiler/section-page-fixture/v2"; category:SectionPageCategory; sections:SectionInstance[]; }

const PAGE_GRAMMARS:Record<SectionPageCategory,readonly SectionKind[]>={
  "b2b-product":["navigation","hero","feature-grid","proof-cloud","comparison","cta","footer"],
  editorial:["navigation","hero","editorial-prose","editorial-media","faq","footer"],
  "premium-consumer":["navigation","hero","bento-grid","product-showcase","proof-cloud","cta","footer"],
  "motion-heavy":["navigation","hero","feature-grid","media-stage","bento-grid","cta","footer"],
  "interactive-2d":["navigation","hero","graphics-2d-stage","feature-grid","faq","cta","footer"],
  "interactive-3d":["navigation","hero","graphics-3d-stage","product-showcase","feature-grid","cta","footer"]
};

function valueFor(field:string,contract:SectionFieldContract,kind:SectionKind):unknown{
  if(contract.type==="link") return {label:`${kind} action`,href:"#evidence"};
  if(contract.type==="items") return [`${kind} evidence item A`,`${kind} evidence item B`];
  if(contract.type==="media") return {assetId:`${kind}-fixture-media`,alt:`${kind} governed media fixture`};
  if(contract.type==="number") return 1;
  return `${kind} ${field} fixture`;
}

function makeSection(kind:SectionKind,index:number):SectionInstance{
  const contract=SECTION_CONTRACTS[kind];
  const props:Record<string,unknown>={};
  const provenance:Record<string,string>={};
  for(const [field,fieldContract] of Object.entries(contract.fields)){
    if(fieldContract.required){props[field]=valueFor(field,fieldContract,kind);provenance[field]=`fixture:${kind}:${field}`;}
  }
  const section:SectionInstance={id:`${String(index+1).padStart(2,"0")}-${kind}`,kind,variant:contract.variants[0]!,props,provenance,tokenRef:"semantic-design-tokens/v2"};
  const errors=validateSectionInstance(section);
  if(errors.length>0) throw new Error(`invalid ${kind} fixture: ${errors.join("; ")}`);
  return section;
}

export function compileSectionPageFixture(category:SectionPageCategory):SectionPageFixture{
  return {schema:"website-design-compiler/section-page-fixture/v2",category,sections:PAGE_GRAMMARS[category].map(makeSection)};
}

export function compileAllSectionPageFixtures():SectionPageFixture[]{return SECTION_PAGE_CATEGORIES.map(compileSectionPageFixture);}
