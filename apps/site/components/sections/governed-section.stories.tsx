import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { GovernedSection } from "./governed-section";

const meta = { title:"Governed Sections/Section", component:GovernedSection, parameters:{layout:"fullscreen"} } satisfies Meta<typeof GovernedSection>;
export default meta;
type Story=StoryObj<typeof meta>;

export const Navigation:Story={args:{kind:"navigation",variant:"product",fields:{brand:"Northstar",links:["Overview","Evidence","Security"],action:{label:"Request access",href:"#contact"}}}};
export const Hero:Story={args:{kind:"hero",variant:"split-media",fields:{eyebrow:"Evidence-first compiler",headline:"Turn a governed brief into a real interface",body:"Canonical fields survive the compiler, authoring, CMS, and renderer boundaries without collapsing into a generic shell.",primaryAction:{label:"Inspect the contract",href:"#contract"},secondaryAction:{label:"See runtime evidence",href:"#evidence"},media:{assetId:"hero-approved-001",alt:"Layered governed interface cards"}}}};
export const FeatureGrid:Story={args:{kind:"feature-grid",variant:"cards",fields:{heading:"A compiler with explicit owners",items:["Reference intelligence","Design contracts","Browser verification"]}}};
export const BentoGrid:Story={args:{kind:"bento-grid",variant:"asymmetric",fields:{heading:"One system, materially different rhythms",items:["A long editorial beat","A compact proof beat","A responsive interaction beat","A governed conversion beat"]}}};
export const ProofCloud:Story={args:{kind:"proof-cloud",variant:"citations",fields:{heading:"Evidence attached at the field boundary",items:["Runtime receipt #142","Accessibility audit #87","License record #31","Performance trace #56"]}}};
export const Metrics:Story={args:{kind:"metrics",variant:"grid",fields:{heading:"Observed, not invented",items:["18 — canonical section contracts","6 — Arena page categories","0 — raw markup escape hatches"]}}};
export const Testimonial:Story={args:{kind:"testimonial",variant:"quote",fields:{quote:"The useful part is not another page builder. It is knowing exactly which evidence made a field publishable.",attribution:"Design systems lead — supplied interview excerpt"}}};
export const Comparison:Story={args:{kind:"comparison",variant:"table",fields:{heading:"Governance remains visible",items:["Compiler output — schema validated","Puck projection — canonical fields preserved","Payload projection — unknown fields rejected"]}}};
export const Pricing:Story={args:{kind:"pricing",variant:"tiers",fields:{heading:"Commercial terms stay evidence-gated",items:["Pilot — supplied scope required","Team — supplied scope required","Enterprise — supplied scope required"]}}};
export const Faq:Story={args:{kind:"faq",variant:"accordion",fields:{heading:"Questions the contract can answer",items:["Who owns semantic order?","Where is provenance stored?","What happens when media is absent?"]}}};
export const Cta:Story={args:{kind:"cta",variant:"split",fields:{headline:"Compile the next governed page",body:"Bring a brief, authored content, and approved media evidence.",action:{label:"Open the compiler",href:"#start"}}}};
export const Footer:Story={args:{kind:"footer",variant:"multi-column",fields:{brand:"Northstar",links:["Contracts","Evidence","Accessibility","Licenses"],legal:"All generated assets remain subject to provenance and rights gates."}}};
export const EditorialProse:Story={args:{kind:"editorial-prose",variant:"longform",fields:{heading:"The interface is only the visible end of the compiler",body:"A reference becomes useful only after its observations are separated from imitation.\nThe resulting art direction then flows through explicit design and content contracts before implementation begins."}}};
export const EditorialMedia:Story={args:{kind:"editorial-media",variant:"figure",fields:{media:{assetId:"editorial-figure-023",alt:"Annotated compiler pipeline diagram"},caption:"An approved figure with asset identity and alternative text kept together."}}};
export const ProductShowcase:Story={args:{kind:"product-showcase",variant:"split",fields:{heading:"The governed artifact remains inspectable",body:"Product copy and approved media travel as separate typed fields with their own provenance.",media:{assetId:"product-capture-009",alt:"Compiler artifact inspector"}}}};
export const MediaStage:Story={args:{kind:"media-stage",variant:"video",fields:{media:{assetId:"motion-reel-004",alt:"Purposeful transition study"},description:"The semantic explanation remains available when the media provider is not admitted."}}};
export const Graphics2dStage:Story={args:{kind:"graphics-2d-stage",variant:"interactive",fields:{description:"A bounded 2D scene enhances the task while the DOM retains essential meaning."}}};
export const Graphics3dStage:Story={args:{kind:"graphics-3d-stage",variant:"spatial",fields:{description:"A progressive spatial preview with a static lower-complexity fallback."}}};
