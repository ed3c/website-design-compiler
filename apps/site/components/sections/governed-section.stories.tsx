import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SECTION_CONTRACTS, type SectionKind } from "../../../../src/section-grammar";
import { GovernedSection } from "./governed-section";

const meta = { title:"Governed Sections/Section", component:GovernedSection, parameters:{layout:"fullscreen"} } satisfies Meta<typeof GovernedSection>;
export default meta;
type Story=StoryObj<typeof meta>;

function canonicalStory(kind:SectionKind,variant:string):Story {
  const contract=SECTION_CONTRACTS[kind];
  if(!contract.variants.includes(variant))throw new Error(`Storybook variant ${variant} is not governed for ${kind}`);
  const label=`${kind} / ${variant}`;
  const fields=Object.fromEntries(Object.entries(contract.fields).map(([name,field])=>{
    const value=kind==="navigation"&&name==="links"?["Overview","Evidence","Security"]
      :field.type==="items"?[`${label} evidence item`,`${label} responsive item`]
      :field.type==="link"?{label:`${label} action`,href:"#storybook-evidence"}
      :field.type==="media"?{assetId:`storybook:${kind}:${variant}`,alt:`${label} approved media`}
      :field.type==="number"?42
      :`${label} governed, provenance-backed ${name}.`;
    return[name,value];
  }));
  const args={
    kind,
    variant,
    fields
  };
  return {args,parameters:{canonicalSection:{kind,variant,fields:Object.keys(contract.fields),claimPolicy:contract.claimPolicy}}};
}

export const Navigation:Story=canonicalStory("navigation","minimal");
export const NavigationProduct:Story=canonicalStory("navigation","product");
export const Hero:Story=canonicalStory("hero","text-first");
export const HeroSplitMedia:Story=canonicalStory("hero","split-media");
export const HeroInteractive:Story=canonicalStory("hero","interactive");
export const FeatureGrid:Story=canonicalStory("feature-grid","cards");
export const FeatureGridRows:Story=canonicalStory("feature-grid","rows");
export const FeatureGridIconGrid:Story=canonicalStory("feature-grid","icon-grid");
export const BentoGrid:Story=canonicalStory("bento-grid","balanced");
export const BentoGridAsymmetric:Story=canonicalStory("bento-grid","asymmetric");
export const ProofCloud:Story=canonicalStory("proof-cloud","logos");
export const ProofCloudCitations:Story=canonicalStory("proof-cloud","citations");
export const Metrics:Story=canonicalStory("metrics","inline");
export const MetricsGrid:Story=canonicalStory("metrics","grid");
export const Testimonial:Story=canonicalStory("testimonial","quote");
export const TestimonialCarouselShell:Story=canonicalStory("testimonial","carousel-shell");
export const Comparison:Story=canonicalStory("comparison","table");
export const ComparisonMatrix:Story=canonicalStory("comparison","matrix");
export const Pricing:Story=canonicalStory("pricing","tiers");
export const PricingSingleOffer:Story=canonicalStory("pricing","single-offer");
export const Faq:Story=canonicalStory("faq","accordion");
export const FaqList:Story=canonicalStory("faq","list");
export const Cta:Story=canonicalStory("cta","band");
export const CtaSplit:Story=canonicalStory("cta","split");
export const Footer:Story=canonicalStory("footer","compact");
export const FooterMultiColumn:Story=canonicalStory("footer","multi-column");
export const EditorialProse:Story=canonicalStory("editorial-prose","article");
export const EditorialProseLongform:Story=canonicalStory("editorial-prose","longform");
export const EditorialMedia:Story=canonicalStory("editorial-media","figure");
export const EditorialMediaGallery:Story=canonicalStory("editorial-media","gallery");
export const ProductShowcase:Story=canonicalStory("product-showcase","split");
export const ProductShowcaseStage:Story=canonicalStory("product-showcase","stage");
export const MediaStage:Story=canonicalStory("media-stage","image");
export const MediaStageVideo:Story=canonicalStory("media-stage","video");
export const Graphics2dStage:Story=canonicalStory("graphics-2d-stage","ambient");
export const Graphics2dStageInteractive:Story=canonicalStory("graphics-2d-stage","interactive");
export const Graphics3dStage:Story=canonicalStory("graphics-3d-stage","product");
export const Graphics3dStageSpatial:Story=canonicalStory("graphics-3d-stage","spatial");
