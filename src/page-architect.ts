import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { buildFrontendPlan } from "./frontend-builder.js";
import { compileInformationArchitecture, type IaSectionStatus, type IaPriority } from "./information-architecture.js";
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
    requiredContent: string[];
    fallback: string;
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
    sectionIntents: ia.sections.map((section) => ({
      id: section.id,
      type: section.type,
      purpose: section.purpose,
      priority: section.priority,
      status: section.status,
      requiredContent: section.requiredContent,
      fallback: section.fallback
    })),
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
