import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PIPELINE_STAGES,
  type CompilerInput,
  type EvidenceState,
  type RuntimeReceipt,
  type StageEvidence
} from "./contracts.js";

const IMPLEMENTED_CORE_STAGES = new Set(["reference-intelligence", "release-receipt"]);

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stageEvidence(stage: string): StageEvidence {
  if (!PIPELINE_STAGES.includes(stage as (typeof PIPELINE_STAGES)[number])) {
    return {
      stage,
      state: "FAIL",
      reason: "Unknown pipeline stage requested.",
      artifacts: []
    };
  }

  if (stage === "reference-intelligence") {
    return {
      stage,
      state: "PASS",
      reason: "Reference Intelligence emits evidence-bounded manifest, analysis, and originality-plan artifacts; unsupported capture modes remain NOT_EXERCISED per entry.",
      artifacts: [
        "reference-intelligence/reference-manifest.json",
        "reference-intelligence/reference-analysis.md",
        "reference-intelligence/originality-plan.json"
      ]
    };
  }

  if (IMPLEMENTED_CORE_STAGES.has(stage)) {
    return {
      stage,
      state: "PASS",
      reason: "Compiler core can emit and bind the runtime receipt for this stage.",
      artifacts: ["runtime-receipt.json"]
    };
  }

  return {
    stage,
    state: "NOT_IMPLEMENTED",
    reason: "Stage contract is known but its executable adapter has not landed yet.",
    artifacts: []
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

export function compile(input: CompilerInput, now = new Date()): RuntimeReceipt {
  const stages = input.requestedStages.map(stageEvidence);

  return {
    schema: "website-design-compiler/runtime-receipt/v1",
    project: input.project,
    generatedAt: now.toISOString(),
    inputSha256: sha256(input),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
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
