import type { EvidenceState, RuntimeReceipt } from "./contracts.js";

export const ARENA_CATEGORIES = [
  "b2b-product",
  "editorial",
  "premium-consumer-brand",
  "motion-heavy-creative",
  "interactive-2d",
  "interactive-3d"
] as const;

export type ArenaCategory = (typeof ARENA_CATEGORIES)[number];

export interface ArenaBenchmarkDefinition {
  id: ArenaCategory;
  pageType: string;
  audience: string;
  objective: string;
}

export interface ArenaMatrix {
  schema: "website-design-compiler/arena-benchmark-matrix/v1";
  categories: ArenaBenchmarkDefinition[];
  requiredCompilerStages: string[];
  requiredGlobalEvidence: string[];
}

export interface ArenaGlobalEvidence {
  [key: string]: EvidenceState;
}

export interface ArenaBenchmarkEvaluation {
  id: ArenaCategory;
  state: "PASS" | "FAIL";
  compilerOverall: EvidenceState;
  inputSha256: string;
  missingStages: string[];
  nonPassStages: Array<{ stage: string; state: EvidenceState }>;
  stageScore: number;
}

export interface ArenaEvaluation {
  schema: "website-design-compiler/arena-score/v1";
  overall: "PASS" | "FAIL";
  categoryCoverage: "PASS" | "FAIL";
  benchmarkScore: number;
  categories: ArenaBenchmarkEvaluation[];
  globalEvidence: Record<string, EvidenceState>;
  missingGlobalEvidence: string[];
  nonPassGlobalEvidence: Array<{ name: string; state: EvidenceState }>;
}

export function evaluateArena(
  matrix: ArenaMatrix,
  receipts: ReadonlyMap<string, RuntimeReceipt>,
  globalEvidence: ArenaGlobalEvidence
): ArenaEvaluation {
  const categoryIds = matrix.categories.map((category) => category.id);
  const categoryCoverage = ARENA_CATEGORIES.every((id) => categoryIds.includes(id)) &&
    categoryIds.every((id) => ARENA_CATEGORIES.includes(id)) &&
    new Set(categoryIds).size === ARENA_CATEGORIES.length
    ? "PASS"
    : "FAIL";

  const categories = matrix.categories.map<ArenaBenchmarkEvaluation>((definition) => {
    const receipt = receipts.get(definition.id);
    if (!receipt) {
      return {
        id: definition.id,
        state: "FAIL",
        compilerOverall: "ABSENT",
        inputSha256: "ABSENT",
        missingStages: [...matrix.requiredCompilerStages],
        nonPassStages: [],
        stageScore: 0
      };
    }

    const stages = new Map(receipt.stages.map((entry) => [entry.stage, entry.state]));
    const missingStages = matrix.requiredCompilerStages.filter((stage) => !stages.has(stage));
    const nonPassStages = matrix.requiredCompilerStages
      .filter((stage) => stages.has(stage) && stages.get(stage) !== "PASS")
      .map((stage) => ({ stage, state: stages.get(stage) ?? "ABSENT" }));
    const passCount = matrix.requiredCompilerStages.filter((stage) => stages.get(stage) === "PASS").length;
    const stageScore = matrix.requiredCompilerStages.length === 0 ? 100 : Math.round((passCount / matrix.requiredCompilerStages.length) * 100);
    const state = receipt.overall === "PASS" && missingStages.length === 0 && nonPassStages.length === 0 ? "PASS" : "FAIL";

    return {
      id: definition.id,
      state,
      compilerOverall: receipt.overall,
      inputSha256: receipt.inputSha256,
      missingStages,
      nonPassStages,
      stageScore
    };
  });

  const normalizedGlobal: Record<string, EvidenceState> = {};
  const missingGlobalEvidence: string[] = [];
  const nonPassGlobalEvidence: Array<{ name: string; state: EvidenceState }> = [];
  for (const name of matrix.requiredGlobalEvidence) {
    const state = globalEvidence[name] ?? "ABSENT";
    normalizedGlobal[name] = state;
    if (!(name in globalEvidence)) missingGlobalEvidence.push(name);
    if (state !== "PASS") nonPassGlobalEvidence.push({ name, state });
  }

  const benchmarkScore = categories.length === 0
    ? 0
    : Math.round(categories.reduce((sum, category) => sum + category.stageScore, 0) / categories.length);
  const overall = categoryCoverage === "PASS" &&
    categories.every((category) => category.state === "PASS") &&
    nonPassGlobalEvidence.length === 0
    ? "PASS"
    : "FAIL";

  return {
    schema: "website-design-compiler/arena-score/v1",
    overall,
    categoryCoverage,
    benchmarkScore,
    categories,
    globalEvidence: normalizedGlobal,
    missingGlobalEvidence,
    nonPassGlobalEvidence
  };
}
