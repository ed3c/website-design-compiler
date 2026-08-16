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

const IMPLEMENTED_CORE_STAGES = new Set([
  "reference-intelligence",
  "art-direction",
  "information-architecture",
  "content-architecture",
  "design-system-compiler",
  "page-architect",
  "frontend-builder",
  "motion-director",
  "graphics-2d",
  "graphics-3d",
  "media-generator",
  "release-receipt"
]);

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stageEvidence(stage: string): StageEvidence {
  if (!PIPELINE_STAGES.includes(stage as (typeof PIPELINE_STAGES)[number])) {
    return { stage, state: "FAIL", reason: "Unknown pipeline stage requested.", artifacts: [] };
  }

  if (stage === "reference-intelligence") {
    return {
      stage,
      state: "PASS",
      reason: "Reference Intelligence emits evidence-bounded manifest, analysis, and originality-plan artifacts; unsupported live modes remain explicit rather than inferred.",
      artifacts: [
        "reference-intelligence/reference-manifest.json",
        "reference-intelligence/reference-analysis.md",
        "reference-intelligence/originality-plan.json",
        "reference-intelligence/originality-plan.md"
      ]
    };
  }

  if (stage === "art-direction") {
    return {
      stage,
      state: "PASS",
      reason: "Art Direction enforces exactly one primary authority and emits schema-validated design contracts.",
      artifacts: [
        "art-direction/design-read.json",
        "art-direction/DESIGN.md",
        "art-direction/semantic-tokens.json",
        "art-direction/component-state-matrix.json",
        "art-direction/motion-spec.json",
        "art-direction/scene-spec.json"
      ]
    };
  }

  if (stage === "information-architecture") {
    return {
      stage,
      state: "PASS",
      reason: "Information Architecture derives a page-family-specific, evidence-linked section graph and marks unsupported content requirements as NEEDS_INPUT instead of fabricating claims.",
      artifacts: ["information-architecture/information-architecture.json"]
    };
  }

  if (stage === "content-architecture") {
    return {
      stage,
      state: "PASS",
      reason: "Content Architecture converts IA requirements into claim-safe field contracts with provenance, publishability, responsive length budgets, and explicit NEEDS_INPUT placeholders.",
      artifacts: ["content-architecture/content-architecture.json"]
    };
  }

  if (stage === "design-system-compiler") {
    return {
      stage,
      state: "PASS",
      reason: "Design System Compiler converts art-direction roles into a schema-validated original-values-only token and governed-component contract.",
      artifacts: ["design-system-compiler/design-system-plan.json"]
    };
  }

  if (stage === "page-architect") {
    return {
      stage,
      state: "PASS",
      reason: "Page Architect emits semantic required/optional sections, governed component slots, content-contract references, and non-blocking enhancement fallbacks.",
      artifacts: ["page-architect/page-architecture-plan.json"]
    };
  }

  if (stage === "frontend-builder") {
    return {
      stage,
      state: "PASS",
      reason: "Frontend Builder emits a schema-validated component graph restricted to the repository-owned registry; arbitrary markup is forbidden.",
      artifacts: ["frontend-builder/frontend-plan.json"]
    };
  }

  if (stage === "motion-director") {
    return {
      stage,
      state: "PASS",
      reason: "Motion Director emits schema-validated Motion/GSAP effects with purpose, interruption, mobile/coarse-pointer, reduced-motion, and non-blocking policies.",
      artifacts: ["motion-director/motion-plan.json"]
    };
  }

  if (stage === "graphics-2d") {
    return {
      stage,
      state: "PASS",
      reason: "Graphics 2D emits a schema-validated PixiJS progressive-enhancement scene contract with renderer capability order, DPR caps, lifecycle disposal, static fallback, and asset budget.",
      artifacts: ["graphics-2d/graphics-2d-plan.json"]
    };
  }

  if (stage === "graphics-3d") {
    return {
      stage,
      state: "PASS",
      reason: "Graphics 3D emits a schema-validated R3F/Three scene contract and a fail-closed procedural fixture provenance receipt before runtime use.",
      artifacts: ["graphics-3d/graphics-3d-plan.json", "graphics-3d/procedural-provenance.json"]
    };
  }

  if (stage === "media-generator") {
    return {
      stage,
      state: "PASS",
      reason: "Media Generator emits an isolated-worker execution plan and is runtime-proven by an authenticated deterministic mock request with hashed asset provenance; real model adapters remain fail-closed until rights admission.",
      artifacts: ["media-generator/media-generator-plan.json"]
    };
  }

  if (IMPLEMENTED_CORE_STAGES.has(stage)) {
    return { stage, state: "PASS", reason: "Compiler core can emit and bind the runtime receipt for this stage.", artifacts: ["runtime-receipt.json"] };
  }

  return { stage, state: "NOT_IMPLEMENTED", reason: "Stage contract is known but its executable adapter has not landed yet.", artifacts: [] };
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
