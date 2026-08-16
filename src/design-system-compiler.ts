import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { buildDesignContractBundle } from "./design-contracts.js";
import { GOVERNED_COMPONENTS } from "./frontend-builder.js";
import { searchVisualDirections, type VisualDirectionDimensions } from "./visual-direction-search.js";
import { validateAgainstSchema } from "./validate.js";

export interface DesignSystemPlan {
  schema: "website-design-compiler/design-system-plan/v1";
  project: string;
  sourceContract: "website-design-compiler/design-contract-bundle/v1";
  identityPolicy: "ORIGINAL_VALUES_ONLY";
  arbitraryComponentAdmission: false;
  selectedVisualDirection: {
    source: "website-design-compiler/visual-direction-search/v2";
    candidateId: string;
    dimensions: VisualDirectionDimensions;
  };
  tokenRoles: {
    color: string[];
    type: string[];
    spacing: string[];
    radii: string[];
    motion: { fastMs: number; baseMs: number; slowMs: number };
  };
  governedComponents: string[];
  requiredStateOwnership: Array<{ component: string; states: string[] }>;
}

export function buildDesignSystemPlan(input: CompilerInput): DesignSystemPlan {
  const contract = buildDesignContractBundle();
  const visualSearch = searchVisualDirections(input);
  return {
    schema: "website-design-compiler/design-system-plan/v1",
    project: input.project,
    sourceContract: contract.schema,
    identityPolicy: "ORIGINAL_VALUES_ONLY",
    arbitraryComponentAdmission: false,
    selectedVisualDirection: {
      source: visualSearch.schema,
      candidateId: visualSearch.selectedCandidateId,
      dimensions: { ...visualSearch.selectedDirection }
    },
    tokenRoles: {
      color: [...contract.tokens.colorRoles],
      type: [...contract.tokens.typeRoles],
      spacing: [...contract.tokens.spacing],
      radii: [...contract.tokens.radii],
      motion: { ...contract.tokens.motion }
    },
    governedComponents: [...GOVERNED_COMPONENTS],
    requiredStateOwnership: contract.componentStates
      .filter((entry) => GOVERNED_COMPONENTS.includes(entry.component as (typeof GOVERNED_COMPONENTS)[number]))
      .map((entry) => ({ component: entry.component, states: [...entry.states] }))
  };
}

export async function writeDesignSystemPlan(input: CompilerInput, outputDirectory: string): Promise<string> {
  const plan = buildDesignSystemPlan(input);
  await validateAgainstSchema(plan, "design-system-plan.schema.json");
  const directory = join(outputDirectory, "design-system-compiler");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "design-system-plan.json");
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}
