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
    mode: "single-page" | "content-led" | "multi-route-ready";
    mobilePriority: string[];
  };
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
      section("editorial-media", "editorial-media", "Pair the narrative with explicitly supplied editorial media.", "SECONDARY", ["editorial-media-asset-id", "editorial-media-alt"], "Omit media when no approved asset and alternative text are provided.", evidence, "NEEDS_INPUT"),
      footer
    ];
  }

  if (family === "premium-consumer") {
    return [
      nav,
      section("brand-hero", "hero-premium", "Create a high-confidence first impression around the product or brand promise.", "PRIMARY", ["headline", "primary-action"], "Use a text-first hero when premium media is unavailable.", evidence),
      section("product-showcase", "product-showcase", "Show product form, use or differentiated experience.", "PRIMARY", ["product-description", "product-media-asset-id", "product-media-alt"], "Omit product media until an approved asset and alternative text are supplied.", evidence),
      section("brand-proof", "proof", "Provide supported reasons to trust the product.", "SECONDARY", ["proof-items"], "Omit social proof until evidence is supplied.", evidence, "NEEDS_INPUT"),
      section("conversion", "cta-band", "Provide the primary conversion action.", "PRIMARY", ["cta-label"], "Use the brief objective as action context without inventing commercial terms.", evidence),
      footer
    ];
  }

  if (family === "motion-heavy-creative") {
    return [
      nav,
      section("creative-hero", "hero-creative", "Establish the concept and a signature interaction opportunity.", "PRIMARY", ["headline", "primary-action"], "Fall back to static semantic hero when motion is disabled.", evidence),
      section("narrative-sequence", "bento-grid", "Build a paced story across distinct semantic beats.", "PRIMARY", ["story-beats"], "Render beats as ordinary sections without scroll choreography.", evidence, "NEEDS_INPUT"),
      section("interactive-showcase", "media-stage", "Provide a justified interactive demonstration.", "SECONDARY", ["interaction-purpose", "stage-media-asset-id", "stage-media-alt"], "Omit the media stage until approved media and explanatory copy are supplied.", evidence),
      section("conversion", "cta-band", "Return from exploration to the primary action.", "PRIMARY", ["cta-label"], "Render a simple CTA band.", evidence),
      footer
    ];
  }

  if (family === "interactive-2d") {
    return [
      nav,
      section("experience-hero", "hero-interactive", "Frame the 2D experience and primary task.", "PRIMARY", ["headline", "task"], "Use semantic copy when canvas is unavailable.", evidence),
      section("pixi-stage", "graphics-2d-stage", "Host the optional 2D interaction without owning essential semantics.", "PRIMARY", ["scene-purpose"], "Use a static poster plus DOM description.", evidence),
      section("how-it-works", "feature-grid", "Explain interaction mechanics and outcomes.", "SECONDARY", ["feature-items"], "Render a simple ordered list.", evidence, "NEEDS_INPUT"),
      section("conversion", "cta-band", "Provide the next primary action.", "PRIMARY", ["cta-label"], "Render semantic button/link only.", evidence),
      footer
    ];
  }

  if (family === "interactive-3d") {
    return [
      nav,
      section("experience-hero", "hero-interactive", "Frame the 3D experience and primary task.", "PRIMARY", ["headline", "task"], "Use semantic copy when WebGL/WebGPU is unavailable.", evidence),
      section("three-stage", "graphics-3d-stage", "Host the optional 3D scene with bounded camera and interaction ownership.", "PRIMARY", ["scene-purpose"], "Use a static poster plus DOM description.", evidence),
      section("capabilities", "feature-grid", "Explain the product or scene capabilities outside the GPU layer.", "SECONDARY", ["feature-items"], "Render a semantic list.", evidence, "NEEDS_INPUT"),
      section("conversion", "cta-band", "Provide the next primary action.", "PRIMARY", ["cta-label"], "Render semantic button/link only.", evidence),
      footer
    ];
  }

  return [
    nav,
    section("hero", "hero-product", "State the product promise and primary action.", "PRIMARY", ["headline", "value-proposition", "primary-action"], "Use concise text-only hero if media is unavailable.", evidence),
    section("features", "feature-grid", "Explain the product capabilities needed to evaluate fit.", "PRIMARY", ["feature-items"], "Render an ordered semantic feature list.", evidence, "NEEDS_INPUT"),
    section("proof", "proof", "Support trust with supplied evidence rather than invented social proof.", "SECONDARY", ["proof-items"], "Omit proof section until evidence is supplied.", evidence, "NEEDS_INPUT"),
    section("conversion", "cta-band", "Provide the primary conversion action after evaluation.", "PRIMARY", ["cta-label"], "Use the brief objective as contextual copy only.", evidence),
    footer
  ];
}

export function compileInformationArchitecture(input: CompilerInput): InformationArchitecturePlan {
  const family = familyFromPageType(input.brief.pageType);
  const availableContent = new Set([
    "brand-or-project-name",
    "project-name",
    ...Object.keys(input.authoredContent ?? {})
  ]);
  const sections = sectionsForFamily(family, input).map((entry) => ({
    ...entry,
    status: entry.requiredContent.every((slot) => availableContent.has(slot))
      ? "READY" as const
      : "NEEDS_INPUT" as const
  }));
  return {
    schema: "website-design-compiler/information-architecture/v2",
    project: input.project,
    family,
    primaryIntent: input.brief.objective,
    navigation: {
      mode: family === "editorial" ? "content-led" : "single-page",
      mobilePriority: ["primary-action", "primary-content", "supporting-content"]
    },
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
