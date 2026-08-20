import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { buildFrontendPlan } from "./frontend-builder.js";
import { compileInformationArchitecture, type IaSectionStatus, type IaPriority } from "./information-architecture.js";
import { compileContentArchitecture, type SectionContentContract } from "./content-architecture.js";
import { validateAgainstSchema } from "./validate.js";

export interface PageArchitecturePlan {
  schema: "website-design-compiler/page-architecture-plan/v1";
  project: string;
  pageType: string;
  primaryObjective: string;
  semanticLandmarks: ["main"];
  sections: Array<{
    id: string;
    role: "hero" | "runtime-evidence" | "progressive-enhancement";
    required: boolean;
    componentIds: string[];
  }>;
  sectionIntents: Array<{
    id: string;
    type: string;
    purpose: string;
    priority: IaPriority;
    status: IaSectionStatus;
    evidence: string[];
    requiredContent: string[];
    missingContent: string[];
    fallback: string;
    contentContract: SectionContentContract & { state: "READY" | "NEEDS_INPUT" };
  }>;
  optionalEnhancements: Array<{
    capability: "motion" | "graphics-2d" | "graphics-3d";
    blocksPrimaryAction: false;
    fallbackRequired: true;
  }>;
}

export function buildPageArchitecturePlan(input: CompilerInput): PageArchitecturePlan {
  const frontend = buildFrontendPlan(input);
  const ia = compileInformationArchitecture(input);
  const content = compileContentArchitecture(input);
  const contentBySection = new Map(content.sections.map((section) => [section.sectionId, section]));
  return {
    schema: "website-design-compiler/page-architecture-plan/v1",
    project: input.project,
    pageType: input.brief.pageType,
    primaryObjective: input.brief.objective,
    semanticLandmarks: ["main"],
    sections: [
      {
        id: "hero",
        role: "hero",
        required: true,
        componentIds: frontend.components.filter((node) => node.component === "button").map((node) => node.id)
      },
      {
        id: "runtime-evidence",
        role: "runtime-evidence",
        required: true,
        componentIds: frontend.components.filter((node) => node.component === "status-panel").map((node) => node.id)
      },
      {
        id: "optional-enhancement",
        role: "progressive-enhancement",
        required: false,
        componentIds: []
      }
    ],
    sectionIntents: ia.sections.map((section) => {
      const contentSection = contentBySection.get(section.id);
      if (!contentSection) throw new Error(`content contract missing for IA section: ${section.id}`);
      const contentState = contentSection.fields.some((field) => field.state === "NEEDS_INPUT") ||
        contentSection.quality.forbiddenPhraseHits.length > 0 ||
        contentSection.quality.repeatedPublishableValues.length > 0
        ? "NEEDS_INPUT"
        : "READY";
      return {
        id: section.id,
        type: section.type,
        purpose: section.purpose,
        priority: section.priority,
        status: contentState,
        evidence: section.evidence,
        requiredContent: section.requiredContent,
        missingContent: section.missingContent,
        fallback: section.fallback,
        contentContract: {
          state: contentState,
          ...contentSection
        }
      };
    }),
    optionalEnhancements: ["motion", "graphics-2d", "graphics-3d"].map((capability) => ({
      capability: capability as "motion" | "graphics-2d" | "graphics-3d",
      blocksPrimaryAction: false as const,
      fallbackRequired: true as const
    }))
  };
}

export async function writePageArchitecturePlan(input: CompilerInput, outputDirectory: string): Promise<string> {
  const plan = buildPageArchitecturePlan(input);
  await validateAgainstSchema(plan, "page-architecture-plan.schema.json");
  const directory = join(outputDirectory, "page-architect");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "page-architecture-plan.json");
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}
