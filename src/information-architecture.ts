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
  missingContent: string[];
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
  availableContent: string[] = []
): IaSection {
  const available = new Set(availableContent);
  const missingContent = requiredContent.filter((item) => !available.has(item));
  return {
    id,
    type,
    purpose,
    priority,
    evidence,
    requiredContent,
    missingContent,
    fallback,
    status: missingContent.length === 0 ? "READY" : "NEEDS_INPUT"
  };
}

type EvidenceField = "project" | "pageType" | "audience" | "objective";

function evidenceFrom(input: CompilerInput, fields: EvidenceField[]): string[] {
  return fields.map((field) => {
    if (field === "project") return `project:${input.project}`;
    return `brief.${field}:${input.brief[field]}`;
  });
}

function sectionsForFamily(family: string, input: CompilerInput): IaSection[] {
  const projectEvidence = evidenceFrom(input, ["project"]);
  const objectiveEvidence = evidenceFrom(input, ["objective"]);
  const audienceAndObjectiveEvidence = evidenceFrom(input, ["audience", "objective"]);
  const pageTypeAndAudienceEvidence = evidenceFrom(input, ["pageType", "audience"]);
  const availableContent = ["brand-or-project-name", "project-name", ...Object.keys(input.authoredContent ?? {})];
  const configuredSection = (
    id: string,
    type: string,
    purpose: string,
    priority: IaPriority,
    requiredContent: string[],
    fallback: string,
    evidence: string[]
  ): IaSection => section(id, type, purpose, priority, requiredContent, fallback, evidence, availableContent);
  const nav = configuredSection("navigation", "navigation", "Expose the primary route and conversion path.", "PRIMARY", ["brand-or-project-name", "primary-action-label"], "Render a compact semantic header without an action until its label and target are supplied.", projectEvidence);
  const footer = configuredSection("footer", "footer", "Close the page with navigation and ownership context.", "SUPPORTING", ["project-name"], "Render a minimal semantic footer without invented company claims.", projectEvidence);

  if (family === "editorial") {
    return [
      nav,
      configuredSection("editorial-hero", "hero-editorial", "Establish topic, editorial promise and reading context.", "PRIMARY", ["headline", "dek"], "Use the brief objective as planning evidence for the dek; require authored headline copy.", audienceAndObjectiveEvidence),
      configuredSection("article-body", "editorial-prose", "Deliver the main evidence-backed narrative.", "PRIMARY", ["body-content"], "Omit the body until source material is supplied.", objectiveEvidence),
      configuredSection("editorial-media", "editorial-media", "Pair the narrative with explicitly supplied editorial media.", "SECONDARY", ["editorial-media-asset-id", "editorial-media-alt"], "Omit media when no approved asset and alternative text are provided.", pageTypeAndAudienceEvidence),
      footer
    ];
  }

  if (family === "premium-consumer") {
    return [
      nav,
      configuredSection("brand-hero", "hero-premium", "Create a high-confidence first impression around the product or brand promise.", "PRIMARY", ["headline", "primary-action"], "Use a text-first shell without publishable claims or actions until authored content is supplied.", audienceAndObjectiveEvidence),
      configuredSection("product-showcase", "product-showcase", "Show product form, use or differentiated experience.", "PRIMARY", ["product-description", "product-media-asset-id", "product-media-alt"], "Omit product media until approved content, asset identity and alternative text are supplied.", pageTypeAndAudienceEvidence),
      configuredSection("brand-proof", "proof", "Provide supported reasons to trust the product.", "SECONDARY", ["proof-items"], "Omit social proof until evidence is supplied.", audienceAndObjectiveEvidence),
      configuredSection("conversion", "cta-band", "Provide the primary conversion action.", "PRIMARY", ["cta-label"], "Omit the action until its label and target are supplied.", objectiveEvidence),
      footer
    ];
  }

  if (family === "motion-heavy-creative") {
    return [
      nav,
      configuredSection("creative-hero", "hero-creative", "Establish the concept and a signature interaction opportunity.", "PRIMARY", ["headline", "primary-action"], "Render a non-publishable semantic shell until authored copy and an action are supplied.", audienceAndObjectiveEvidence),
      configuredSection("narrative-sequence", "bento-grid", "Build a paced story across distinct semantic beats.", "PRIMARY", ["story-beats"], "Render ordinary semantic sections without choreography until authored story beats are supplied.", pageTypeAndAudienceEvidence),
      configuredSection("interactive-showcase", "media-stage", "Provide a justified interactive demonstration.", "SECONDARY", ["interaction-purpose", "stage-media-asset-id", "stage-media-alt"], "Omit the media stage until approved media and explanatory copy are supplied.", objectiveEvidence),
      configuredSection("conversion", "cta-band", "Return from exploration to the primary action.", "PRIMARY", ["cta-label"], "Omit the action until its label and target are supplied.", objectiveEvidence),
      footer
    ];
  }

  if (family === "interactive-2d") {
    return [
      nav,
      configuredSection("experience-hero", "hero-interactive", "Frame the 2D experience and primary task.", "PRIMARY", ["headline", "task"], "Use the objective as task-planning evidence and require authored headline copy.", audienceAndObjectiveEvidence),
      configuredSection("pixi-stage", "graphics-2d-stage", "Host the optional 2D interaction without owning essential semantics.", "PRIMARY", ["scene-purpose"], "Use a static poster and objective-derived planning note; do not invent explanatory copy.", objectiveEvidence),
      configuredSection("how-it-works", "feature-grid", "Explain interaction mechanics and outcomes.", "SECONDARY", ["feature-items"], "Omit the list until feature evidence is supplied.", pageTypeAndAudienceEvidence),
      configuredSection("conversion", "cta-band", "Provide the next primary action.", "PRIMARY", ["cta-label"], "Omit the action until its label and target are supplied.", objectiveEvidence),
      footer
    ];
  }

  if (family === "interactive-3d") {
    return [
      nav,
      configuredSection("experience-hero", "hero-interactive", "Frame the 3D experience and primary task.", "PRIMARY", ["headline", "task"], "Use the objective as task-planning evidence and require authored headline copy.", audienceAndObjectiveEvidence),
      configuredSection("three-stage", "graphics-3d-stage", "Host the optional 3D scene with bounded camera and interaction ownership.", "PRIMARY", ["scene-purpose"], "Use a static poster and objective-derived planning note; do not invent explanatory copy.", objectiveEvidence),
      configuredSection("capabilities", "feature-grid", "Explain the product or scene capabilities outside the GPU layer.", "SECONDARY", ["feature-items"], "Omit the list until feature evidence is supplied.", pageTypeAndAudienceEvidence),
      configuredSection("conversion", "cta-band", "Provide the next primary action.", "PRIMARY", ["cta-label"], "Omit the action until its label and target are supplied.", objectiveEvidence),
      footer
    ];
  }

  return [
    nav,
    configuredSection("hero", "hero-product", "State the product promise and primary action.", "PRIMARY", ["headline", "value-proposition", "primary-action"], "Use the objective as value-proposition planning evidence; require authored headline and action copy.", audienceAndObjectiveEvidence),
    configuredSection("features", "feature-grid", "Explain the product capabilities needed to evaluate fit.", "PRIMARY", ["feature-items"], "Omit the list until feature evidence is supplied.", pageTypeAndAudienceEvidence),
    configuredSection("proof", "proof", "Support trust with supplied evidence rather than invented social proof.", "SECONDARY", ["proof-items"], "Omit proof section until evidence is supplied.", audienceAndObjectiveEvidence),
    configuredSection("conversion", "cta-band", "Provide the primary conversion action after evaluation.", "PRIMARY", ["cta-label"], "Omit the action until its label and target are supplied.", objectiveEvidence),
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
