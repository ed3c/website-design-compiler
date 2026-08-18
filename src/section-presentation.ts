import { SECTION_CONTRACTS, type SectionKind } from "./section-grammar.js";
import type { VisualDirectionDimensions } from "./visual-direction-search.js";

function supportedVariant(kind:SectionKind,preferred:string):string{
  return SECTION_CONTRACTS[kind].variants.find((variant)=>variant===preferred)??SECTION_CONTRACTS[kind].variants[0]!;
}

export function selectSectionVariant(kind:SectionKind,sectionType:string,direction:VisualDirectionDimensions):string{
  if(kind==="hero")return supportedVariant(kind,sectionType==="hero-editorial"?"text-first":sectionType==="hero-premium"?"split-media":sectionType==="hero-creative"||sectionType==="hero-interactive"?"interactive":direction.mediaStrategy==="product-media"?"split-media":"text-first");
  if(kind==="navigation")return supportedVariant(kind,direction.grid==="modular"?"product":"minimal");
  if(kind==="footer")return supportedVariant(kind,direction.grid==="modular"?"multi-column":"compact");
  if(kind==="feature-grid")return supportedVariant(kind,direction.grid==="editorial"?"rows":direction.grid==="asymmetric"?"icon-grid":"cards");
  if(kind==="bento-grid")return supportedVariant(kind,direction.grid==="asymmetric"?"asymmetric":"balanced");
  if(kind==="proof-cloud")return supportedVariant(kind,"citations");
  if(kind==="cta")return supportedVariant(kind,direction.grid==="asymmetric"||direction.grid==="editorial"?"split":"band");
  if(kind==="faq")return supportedVariant(kind,direction.grid==="editorial"?"list":"accordion");
  if(kind==="editorial-prose")return supportedVariant(kind,direction.density==="airy"?"longform":"article");
  if(kind==="product-showcase")return supportedVariant(kind,direction.surface==="layered"?"stage":"split");
  if(kind==="media-stage")return supportedVariant(kind,direction.mediaStrategy==="interactive-stage"?"video":"image");
  if(kind==="graphics-2d-stage")return supportedVariant(kind,direction.signatureInteraction==="direct-manipulation"?"interactive":"ambient");
  if(kind==="graphics-3d-stage")return supportedVariant(kind,direction.signatureInteraction==="spatial-focus"?"spatial":"product");
  return SECTION_CONTRACTS[kind].variants[0]!;
}
