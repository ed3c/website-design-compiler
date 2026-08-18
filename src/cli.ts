#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { compile, writeRuntimeReceipt } from "./compiler.js";
import { writeReferenceIntelligenceArtifacts } from "./reference-intelligence.js";
import { writeDesignContracts } from "./design-contracts.js";
import { writeInformationArchitecturePlan } from "./information-architecture.js";
import { writeContentArchitecturePlan } from "./content-architecture.js";
import { writeVisualDirectionSearch } from "./visual-direction-search.js";
import { writeDesignSystemPlan } from "./design-system-compiler.js";
import { writePageArchitecturePlan } from "./page-architect.js";
import { writeFrontendPlan } from "./frontend-builder.js";
import { writeMotionDirectorPlan } from "./motion-director.js";
import { writeGraphics2DPlan } from "./graphics-2d.js";
import { writeGraphics3DArtifacts } from "./graphics-3d.js";
import { writeMediaGeneratorPlan } from "./media-generator.js";
import { ContractValidationError, validateCompilerInput } from "./validate.js";
import type { StageExecutionEvidence } from "./contracts.js";

type StageWriterOutput = string | string[] | StageExecutionEvidence;

function isStageExecutionEvidence(value: StageWriterOutput): value is StageExecutionEvidence {
  return typeof value === "object" && !Array.isArray(value);
}

async function main(): Promise<void> {
  const [inputPath, outputDirectory] = process.argv.slice(2);
  if (!inputPath || !outputDirectory) {
    console.error("usage: website-design-compiler <input.json> <output-directory>");
    process.exitCode = 2;
    return;
  }

  try {
    const raw = JSON.parse(await readFile(resolve(inputPath), "utf8")) as unknown;
    const input = await validateCompilerInput(raw);
    const resolvedOutputDirectory = resolve(outputDirectory);
    const executedStages = new Map<string, StageExecutionEvidence>();

    const executeStage = async (stage: string, writer: () => Promise<StageWriterOutput>): Promise<void> => {
      const result = await writer();
      const execution = isStageExecutionEvidence(result)
        ? result
        : { state: "PASS" as const, reason: "The stage writer completed.", artifacts: Array.isArray(result) ? result : [result] };
      executedStages.set(stage, {
        ...execution,
        artifacts: execution.artifacts.map((path) => relative(resolvedOutputDirectory, path))
      });
    };

    if (input.requestedStages.includes("reference-intelligence")) await executeStage("reference-intelligence", () => writeReferenceIntelligenceArtifacts(input, resolvedOutputDirectory));
    if (input.requestedStages.includes("art-direction")) await executeStage("art-direction", () => writeDesignContracts(input, resolvedOutputDirectory));
    if (input.requestedStages.includes("information-architecture")) await executeStage("information-architecture", () => writeInformationArchitecturePlan(input, resolvedOutputDirectory));
    if (input.requestedStages.includes("content-architecture")) await executeStage("content-architecture", () => writeContentArchitecturePlan(input, resolvedOutputDirectory));
    if (input.requestedStages.includes("visual-direction-search")) await executeStage("visual-direction-search", () => writeVisualDirectionSearch(input, resolvedOutputDirectory));
    if (input.requestedStages.includes("design-system-compiler")) await executeStage("design-system-compiler", () => writeDesignSystemPlan(input, resolvedOutputDirectory));
    if (input.requestedStages.includes("page-architect")) await executeStage("page-architect", () => writePageArchitecturePlan(input, resolvedOutputDirectory));
    if (input.requestedStages.includes("frontend-builder")) await executeStage("frontend-builder", () => writeFrontendPlan(input, resolvedOutputDirectory));
    if (input.requestedStages.includes("motion-director")) await executeStage("motion-director", () => writeMotionDirectorPlan(input, resolvedOutputDirectory));
    if (input.requestedStages.includes("graphics-2d")) await executeStage("graphics-2d", () => writeGraphics2DPlan(resolvedOutputDirectory));
    if (input.requestedStages.includes("graphics-3d")) await executeStage("graphics-3d", () => writeGraphics3DArtifacts(resolvedOutputDirectory));
    if (input.requestedStages.includes("media-generator")) await executeStage("media-generator", () => writeMediaGeneratorPlan(resolvedOutputDirectory));

    if (input.requestedStages.includes("release-receipt")) {
      executedStages.set("release-receipt", {
        state: "PASS",
        reason: "The runtime receipt target is bound to this compiler invocation.",
        artifacts: ["runtime-receipt.json"]
      });
    }

    const receipt = compile(input, new Date(), executedStages);
    const receiptPath = await writeRuntimeReceipt(receipt, resolvedOutputDirectory);
    console.log(JSON.stringify({ receiptPath, overall: receipt.overall }));
    process.exitCode = receipt.overall === "PASS" ? 0 : 1;
  } catch (error) {
    if (error instanceof ContractValidationError) {
      console.error(JSON.stringify({ state: "FAIL", kind: "CONTRACT_VALIDATION", errors: error.validationErrors }));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
