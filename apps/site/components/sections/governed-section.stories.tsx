import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SECTION_CONTRACTS, type SectionKind } from "../../../../src/section-grammar";
import { GovernedSection } from "./governed-section";

const meta = { title:"Governed Sections/Section", component:GovernedSection, parameters:{layout:"fullscreen"} } satisfies Meta<typeof GovernedSection>;
export default meta;
type Story=StoryObj<typeof meta>;

function canonicalStory(kind:SectionKind,variant:string):Story {
  const contract=SECTION_CONTRACTS[kind];
  if(!contract.variants.includes(variant))throw new Error(`Storybook variant ${variant} is not governed for ${kind}`);
  const fieldNames=new Set(Object.keys(contract.fields));
  const label=`${kind} / ${variant}`;
  const args={
    kind,
    variant,
    heading:fieldNames.has("headline")||fieldNames.has("heading")||fieldNames.has("brand")?`${label} heading`:undefined,
    body:fieldNames.has("quote")||fieldNames.has("body")||fieldNames.has("description")||fieldNames.has("caption")||fieldNames.has("legal")?`${label} governed, provenance-backed copy.`:undefined,
    items:fieldNames.has("items")?[`${label} evidence item`,`${label} responsive item`]:undefined,
    links:fieldNames.has("links")?[{label:`${label} link`,href:"#storybook-evidence"}]:undefined,
    action:fieldNames.has("action")||fieldNames.has("primaryAction")?{label:`${label} action`,href:"#storybook-evidence"}:undefined
  };
  return {args,parameters:{canonicalSection:{kind,variant,fields:[...fieldNames],claimPolicy:contract.claimPolicy}}};
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
