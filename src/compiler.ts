import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PIPELINE_STAGES,
  type CompilerInput,
  type EvidenceState,
  type PipelineStageName,
  type RuntimeReceipt,
  type StageExecutionEvidence,
  type StageEvidence
} from "./contracts.js";

const IMPLEMENTED_CORE_STAGES = new Set([
  "reference-intelligence",
  "art-direction",
  "information-architecture",
  "content-architecture",
  "visual-direction-search",
  "design-system-compiler",
  "page-architect",
  "frontend-builder",
  "motion-director",
  "graphics-2d",
  "graphics-3d",
  "media-generator",
  "release-receipt"
]);

const STAGE_PASS_REASONS: Partial<Record<PipelineStageName, string>> = {
  "reference-intelligence": "Reference Intelligence emitted evidence-bounded manifest, analysis, and originality-plan artifacts.",
  "art-direction": "Art Direction enforced exactly one primary authority and emitted schema-validated design contracts.",
  "information-architecture": "Information Architecture emitted an evidence-linked section graph with unsupported content marked NEEDS_INPUT.",
  "content-architecture": "Content Architecture emitted claim-safe field contracts with provenance, publishability, length budgets, and explicit missing inputs.",
  "visual-direction-search": "Visual Direction Search emitted ranked candidates with explicit originality and delivery-risk decisions.",
  "design-system-compiler": "Design System Compiler emitted a schema-validated token and governed-component contract.",
  "page-architect": "Page Architect emitted semantic sections, governed component slots, and enhancement fallbacks.",
  "frontend-builder": "Frontend Builder emitted a schema-validated component graph restricted to the repository registry.",
  "motion-director": "Motion Director emitted schema-validated effects with interruption, device, and reduced-motion policies.",
  "graphics-2d": "Graphics 2D emitted a schema-validated progressive-enhancement scene contract.",
  "graphics-3d": "Graphics 3D emitted a schema-validated scene contract and procedural provenance receipt.",
  "media-generator": "Media Generator emitted an isolated-worker execution plan with bounded provenance policy.",
  "release-receipt": "The compiler invocation reached the runtime-receipt writer with all prior requested stages classified."
};

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stageEvidence(stage: string, executedStages: ReadonlyMap<string, StageExecutionEvidence>): StageEvidence {
  if (!PIPELINE_STAGES.includes(stage as (typeof PIPELINE_STAGES)[number])) {
    return { stage, state: "FAIL", reason: "Unknown pipeline stage requested.", artifacts: [] };
  }

  if (!IMPLEMENTED_CORE_STAGES.has(stage)) {
    return { stage, state: "NOT_IMPLEMENTED", reason: "Stage contract is known but its executable adapter has not landed yet.", artifacts: [] };
  }

  const execution = executedStages.get(stage);
  if (!execution || execution.artifacts.length === 0) {
    return {
      stage,
      state: "NOT_EXERCISED",
      reason: "The stage adapter is implemented, but this invocation supplied no emitted artifact evidence.",
      artifacts: []
    };
  }

  if (execution.state !== "PASS") {
    return { stage, state: execution.state, reason: execution.reason, artifacts: [...execution.artifacts] };
  }

  return {
    stage,
    state: "PASS",
    reason: STAGE_PASS_REASONS[stage as PipelineStageName] ?? "The stage emitted runtime-bound artifacts.",
    artifacts: [...execution.artifacts]
  };
}

function overallState(stages: StageEvidence[]): EvidenceState {
  if (stages.some((stage) => stage.state === "FAIL")) return "FAIL";
  if (stages.some((stage) => stage.state === "NOT_IMPLEMENTED")) return "NOT_IMPLEMENTED";
  if (stages.some((stage) => stage.state === "ABSENT")) return "ABSENT";
  if (stages.some((stage) => stage.state === "NOT_EXERCISED")) return "NOT_EXERCISED";
  if (stages.every((stage) => stage.state === "SKIPPED_BY_POLICY")) return "SKIPPED_BY_POLICY";
  return "PASS";
}

export function compile(
  input: CompilerInput,
  now = new Date(),
  executedStages: ReadonlyMap<string, StageExecutionEvidence> = new Map()
): RuntimeReceipt {
  const stages = input.requestedStages.map((stage) => stageEvidence(stage, executedStages));
  return {
    schema: "website-design-compiler/runtime-receipt/v1",
    project: input.project,
    generatedAt: now.toISOString(),
    inputSha256: sha256(input),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    stages,
    overall: overallState(stages)
  };
}

export async function writeRuntimeReceipt(receipt: RuntimeReceipt, outputDirectory: string): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const path = join(outputDirectory, "runtime-receipt.json");
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return path;
}
