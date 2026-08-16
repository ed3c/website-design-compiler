#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile, writeRuntimeReceipt } from "./compiler.js";
import { writeReferenceIntelligenceArtifacts } from "./reference-intelligence.js";
import { writeDesignContracts } from "./design-contracts.js";
import { writeFrontendPlan } from "./frontend-builder.js";
import { ContractValidationError, validateCompilerInput } from "./validate.js";

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

    if (input.requestedStages.includes("reference-intelligence")) {
      await writeReferenceIntelligenceArtifacts(input, resolvedOutputDirectory);
    }
    if (input.requestedStages.includes("art-direction")) {
      await writeDesignContracts(input, resolvedOutputDirectory);
    }
    if (input.requestedStages.includes("frontend-builder")) {
      await writeFrontendPlan(input, resolvedOutputDirectory);
    }

    const receipt = compile(input);
    const receiptPath = await writeRuntimeReceipt(receipt, resolvedOutputDirectory);
    console.log(JSON.stringify({ receiptPath, overall: receipt.overall }));
    process.exitCode = receipt.overall === "FAIL" ? 1 : 0;
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
