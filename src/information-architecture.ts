import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { validateAgainstSchema } from "./validate.js";

export type IaSectionStatus = "READY" | "NEEDS_INPUT";
export type IaPriority = "PRIMARY" | "SECONDARY" | "SUPPORTING";

export interface IaSection {
  id: string;
  type: string;
  purpose: string;
  priority: IaPriority;
  evidence: string[];
  requiredContent: string[];
  fallback: string;
  status: IaSectionStatus;
}

export interface InformationArchitecturePlan {
  schema: "website-design-compiler/information-architecture/v2";
  project: string;
  family: string;
  primaryIntent: string;
  navigation: {
    mode: "content-led" | "multi-route-ready";
    mobilePriority: string[];
  };
  routes: Array<{
    route: string;
    label: string;
    intent: string;
    sectionIds: string[];
  }>;
  sections: IaSection[];
  forbiddenInventions: string[];
}

function familyFromPageType(pageType: string): string {
  const value = pageType.toLowerCase();
  if (value.includes("editorial") || value.includes("magazine") || value.includes("publication")) return "editorial";
  if (value.includes("premium") || value.includes("luxury") || value.includes("consumer")) return "premium-consumer";
  if (value.includes("motion") || value.includes("creative") || value.includes("immersive")) return "motion-heavy-creative";
  if (value.includes("2d") || value.includes("pixi") || value.includes("canvas")) return "interactive-2d";
  if (value.includes("3d") || value.includes("webgl") || value.includes("webgpu") || value.includes("three")) return "interactive-3d";
  return "b2b-product";
}

function section(
  id: string,
  type: string,
  purpose: string,
  priority: IaPriority,
  requiredContent: string[],
  fallback: string,
  evidence: string[],
  status: IaSectionStatus = "READY"
): IaSection {
  return { id, type, purpose, priority, evidence, requiredContent, fallback, status };
}

function commonEvidence(input: CompilerInput): string[] {
  return [
    `brief.pageType:${input.brief.pageType}`,
    `brief.audience:${input.brief.audience}`,
    `brief.objective:${input.brief.objective}`
  ];
}

function sectionsForFamily(family: string, input: CompilerInput): IaSection[] {
  const evidence = commonEvidence(input);
  const nav = section("navigation", "navigation", "Expose the primary route and conversion path.", "PRIMARY", ["brand-or-project-name", "primary-action-label"], "Render a compact semantic header with the primary action.", evidence);
  const footer = section("footer", "footer", "Close the page with navigation and ownership context.", "SUPPORTING", ["project-name"], "Render a minimal semantic footer without invented company claims.", evidence);

  if (family === "editorial") {
    return [
      nav,
      section("editorial-hero", "hero-editorial", "Establish topic, editorial promise and reading context.", "PRIMARY", ["headline", "dek"], "Use brief objective as the dek if supported.", evidence),
      section("article-body", "editorial-prose", "Deliver the main evidence-backed narrative.", "PRIMARY", ["body-content"], "Mark content as NEEDS_INPUT when no source material is supplied.", evidence, "NEEDS_INPUT"),
      section("related-content", "related-content", "Offer optional continuation without fabricating articles.", "SECONDARY", ["headline", "related-items"], "Omit when no related items are provided.", evidence, "NEEDS_INPUT"),
      footer
    ];
  }

  if (family === "premium-consumer") {
    return [
      nav,
      section("brand-hero", "hero-premium", "Create a high-confidence first impression around the product or brand promise.", "PRIMARY", ["headline", "value-proposition", "primary-action"], "Use a text-first hero when premium media is unavailable.", evidence),
      section("product-showcase", "product-showcase", "Show product form, use or differentiated experience.", "PRIMARY", ["headline", "product-description"], "Use semantic copy and a static media placeholder when no approved asset exists.", evidence),
      section("brand-proof", "proof", "Provide supported reasons to trust the product.", "SECONDARY", ["proof-items"], "Omit social proof until evidence is supplied.", evidence, "NEEDS_INPUT"),
      section("conversion", "cta-band", "Provide the primary conversion action.", "PRIMARY", ["cta-headline", "cta-label"], "Use the brief objective as action context without inventing commercial terms.", evidence),
      footer
    ];
  }

  if (family === "motion-heavy-creative") {
    return [
      nav,
      section("creative-hero", "hero-creative", "Establish the concept and a signature interaction opportunity.", "PRIMARY", ["headline", "value-proposition", "primary-action"], "Fall back to static semantic hero when motion is disabled.", evidence),
      section("narrative-sequence", "narrative-sequence", "Build a paced story across distinct semantic beats.", "PRIMARY", ["story-beats"], "Render beats as ordinary sections without scroll choreography.", evidence, "NEEDS_INPUT"),
      section("interactive-showcase", "interactive-stage", "Provide a justified interactive demonstration.", "SECONDARY", ["interaction-purpose"], "Use static poster and explanatory DOM copy.", evidence),
      section("conversion", "cta-band", "Return from exploration to the primary action.", "PRIMARY", ["cta-headline", "cta-label"], "Render a simple CTA band.", evidence),
      footer
    ];
  }

  if (family === "interactive-2d") {
    return [
      nav,
      section("experience-hero", "hero-interactive", "Frame the 2D experience and primary task.", "PRIMARY", ["headline", "task", "primary-action"], "Use semantic copy when canvas is unavailable.", evidence),
      section("pixi-stage", "graphics-2d-stage", "Host the optional 2D interaction without owning essential semantics.", "PRIMARY", ["scene-purpose"], "Use a static poster plus DOM description.", evidence),
      section("how-it-works", "feature-grid", "Explain interaction mechanics and outcomes.", "SECONDARY", ["headline", "feature-items"], "Render a simple ordered list.", evidence, "NEEDS_INPUT"),
      section("conversion", "cta-band", "Provide the next primary action.", "PRIMARY", ["cta-headline", "cta-label"], "Render semantic button/link only.", evidence),
      footer
    ];
  }

  if (family === "interactive-3d") {
    return [
      nav,
      section("experience-hero", "hero-interactive", "Frame the 3D experience and primary task.", "PRIMARY", ["headline", "task", "primary-action"], "Use semantic copy when WebGL/WebGPU is unavailable.", evidence),
      section("three-stage", "graphics-3d-stage", "Host the optional 3D scene with bounded camera and interaction ownership.", "PRIMARY", ["scene-purpose"], "Use a static poster plus DOM description.", evidence),
      section("capabilities", "feature-grid", "Explain the product or scene capabilities outside the GPU layer.", "SECONDARY", ["headline", "feature-items"], "Render a semantic list.", evidence, "NEEDS_INPUT"),
      section("conversion", "cta-band", "Provide the next primary action.", "PRIMARY", ["cta-headline", "cta-label"], "Render semantic button/link only.", evidence),
      footer
    ];
  }

  return [
    nav,
    section("hero", "hero-product", "State the product promise and primary action.", "PRIMARY", ["headline", "value-proposition", "primary-action"], "Use concise text-only hero if media is unavailable.", evidence),
    section("features", "feature-grid", "Explain the product capabilities needed to evaluate fit.", "PRIMARY", ["headline", "feature-items"], "Render an ordered semantic feature list.", evidence, "NEEDS_INPUT"),
    section("proof", "proof", "Support trust with supplied evidence rather than invented social proof.", "SECONDARY", ["proof-items"], "Omit proof section until evidence is supplied.", evidence, "NEEDS_INPUT"),
    section("conversion", "cta-band", "Provide the primary conversion action after evaluation.", "PRIMARY", ["cta-headline", "cta-label"], "Use the brief objective as contextual copy only.", evidence),
    footer
  ];
}

function routesForFamily(family: string, sections: readonly IaSection[]): InformationArchitecturePlan["routes"] {
  const sectionIds=sections.map((section)=>section.id);
  const secondary:Record<string,{route:string;label:string}>={
    "b2b-product":{route:"/product",label:"Product"},
    editorial:{route:"/stories",label:"Stories"},
    "premium-consumer":{route:"/collection",label:"Collection"},
    "motion-heavy-creative":{route:"/work",label:"Work"},
    "interactive-2d":{route:"/experience",label:"Experience"},
    "interactive-3d":{route:"/showcase",label:"Showcase"}
  };
  const route=secondary[family]!;
  return [
    {route:"/",label:"Home",intent:"Establish the primary intent and governed conversion path.",sectionIds:[...sectionIds]},
    {route:route.route,label:route.label,intent:`Provide a dedicated ${route.label.toLowerCase()} route without changing the governed content contract.`,sectionIds:[...sectionIds]}
  ];
}

export function compileInformationArchitecture(input: CompilerInput): InformationArchitecturePlan {
  const family = familyFromPageType(input.brief.pageType);
  const sections=sectionsForFamily(family,input);
  return {
    schema: "website-design-compiler/information-architecture/v2",
    project: input.project,
    family,
    primaryIntent: input.brief.objective,
    navigation: {
      mode: family === "editorial" ? "content-led" : "multi-route-ready",
      mobilePriority: ["primary-action", "primary-content", "supporting-content"]
    },
    routes:routesForFamily(family,sections),
    sections,
    forbiddenInventions: ["customer-logos", "testimonials", "metrics", "pricing", "customer-names", "performance-claims"]
  };
}

export async function writeInformationArchitecturePlan(input: CompilerInput, outputDirectory: string): Promise<string> {
  const plan = compileInformationArchitecture(input);
  await validateAgainstSchema(plan, "information-architecture-v2.schema.json");
  const directory = join(outputDirectory, "information-architecture");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "information-architecture.json");
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}
