import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceState, RuntimeReceipt } from "../src/contracts.js";

const root = process.cwd();
const compilerRoot = join(root, "artifacts", "showcase", "compiler");
const runtimeReceiptPath = join(compilerRoot, "runtime-receipt.json");
const checkedInPlanPath = join(root, "apps", "site", "generated", "showcase-frontend-plan.json");
const generatedPlanPath = join(compilerRoot, "frontend-builder", "frontend-plan.json");
const outputPath = join(root, "artifacts", "showcase", "showcase-compiler-receipt.json");

const requiredStages = [
  "reference-intelligence",
  "art-direction",
  "visual-direction-search",
  "design-system-compiler",
  "page-architect",
  "frontend-builder",
  "motion-director",
  "graphics-2d",
  "graphics-3d",
  "release-receipt"
] as const;

const requiredArtifacts = [
  "reference-intelligence/reference-manifest.json",
  "reference-intelligence/reference-analysis.md",
  "reference-intelligence/originality-plan.json",
  "reference-intelligence/originality-plan.md",
  "art-direction/design-read.json",
  "art-direction/DESIGN.md",
  "art-direction/semantic-tokens.json",
  "art-direction/component-state-matrix.json",
  "art-direction/motion-spec.json",
  "art-direction/scene-spec.json",
  "visual-direction-search/visual-direction-search.json",
  "design-system-compiler/design-system-plan.json",
  "page-architect/page-architecture-plan.json",
  "frontend-builder/frontend-plan.json",
  "motion-director/motion-plan.json",
  "graphics-2d/graphics-2d-plan.json",
  "graphics-3d/graphics-3d-plan.json",
  "graphics-3d/procedural-provenance.json",
  "runtime-receipt.json"
] as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const runtimeReceipt = JSON.parse(await readFile(runtimeReceiptPath, "utf8")) as RuntimeReceipt;
const stageMap = new Map(runtimeReceipt.stages.map((stage) => [stage.stage, stage]));
const stageStates = Object.fromEntries(requiredStages.map((stage) => [stage, (stageMap.get(stage)?.state ?? "ABSENT") as EvidenceState]));
const missingArtifacts: string[] = [];
for (const artifact of requiredArtifacts) {
  if (!(await exists(join(compilerRoot, artifact)))) missingArtifacts.push(artifact);
}

const checkedInPlan = JSON.parse(await readFile(checkedInPlanPath, "utf8")) as unknown;
const generatedPlan = JSON.parse(await readFile(generatedPlanPath, "utf8")) as unknown;
const projectionMatchesCompiler = canonical(checkedInPlan) === canonical(generatedPlan);
const allStagesPass = Object.values(stageStates).every((state) => state === "PASS");
const overall = runtimeReceipt.overall === "PASS" && allStagesPass && missingArtifacts.length === 0 && projectionMatchesCompiler ? "PASS" : "FAIL";

const receipt = {
  schema: "website-design-compiler/showcase-compiler-receipt/v1",
  overall,
  git: { sha: process.env.GITHUB_SHA ?? "UNBOUND", ref: process.env.GITHUB_REF ?? "UNBOUND" },
  fixture: "fixtures/showcase/compiler-input.json",
  runtimeReceipt: "artifacts/showcase/compiler/runtime-receipt.json",
  stageStates,
  requiredArtifacts: [...requiredArtifacts],
  missingArtifacts,
  projection: {
    checkedIn: "apps/site/generated/showcase-frontend-plan.json",
    generated: "artifacts/showcase/compiler/frontend-builder/frontend-plan.json",
    matchesCompiler: projectionMatchesCompiler
  },
  route: "/showcase",
  fallbackQuery: "?graphics=off&graphics3d=off"
};

await mkdir(join(root, "artifacts", "showcase"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, overall, missingArtifacts, projectionMatchesCompiler }));
if (overall !== "PASS") process.exitCode = 1;
