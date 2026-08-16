import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { validateAgainstSchema } from "./validate.js";

export const GOVERNED_COMPONENTS = ["button", "status-panel"] as const;
export type GovernedComponentName = (typeof GOVERNED_COMPONENTS)[number];

type ButtonNode = {
  id: string;
  component: "button";
  props: {
    intent?: "primary" | "secondary";
    children: string;
    disabled?: boolean;
  };
};

type StatusPanelNode = {
  id: string;
  component: "status-panel";
  props: {
    state: "loading" | "empty" | "error" | "success";
    title: string;
    message: string;
  };
};

export type ComponentNode = ButtonNode | StatusPanelNode;

export interface FrontendPlan {
  schema: "website-design-compiler/frontend-plan/v1";
  project: string;
  renderer: "nextjs-registry";
  arbitraryMarkupAllowed: false;
  components: ComponentNode[];
}

export function buildFrontendPlan(input: CompilerInput): FrontendPlan {
  return {
    schema: "website-design-compiler/frontend-plan/v1",
    project: input.project,
    renderer: "nextjs-registry",
    arbitraryMarkupAllowed: false,
    components: [
      {
        id: "primary-action",
        component: "button",
        props: { intent: "primary", children: "Open compiler contract" }
      },
      {
        id: "runtime-status",
        component: "status-panel",
        props: {
          state: "success",
          title: "Runtime status",
          message: "Governed component plan emitted"
        }
      }
    ]
  };
}

export async function writeFrontendPlan(input: CompilerInput, outputDirectory: string): Promise<string> {
  const directory = join(outputDirectory, "frontend-builder");
  await mkdir(directory, { recursive: true });
  const plan = buildFrontendPlan(input);
  await validateAgainstSchema<FrontendPlan>(plan, "frontend-plan.schema.json");
  const path = join(directory, "frontend-plan.json");
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}
