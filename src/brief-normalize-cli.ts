#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { normalizeBrief, type NaturalLanguageBriefInput } from "./brief-normalizer.js";
import { ContractValidationError, validateAgainstSchema, validateCompilerInput } from "./validate.js";

async function main(): Promise<void> {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error("usage: brief-normalize <brief-input.json> <normalization-receipt.json>");
    process.exitCode = 2;
    return;
  }

  const parsed = JSON.parse(await readFile(resolve(inputPath), "utf8")) as unknown;
  const raw = await validateAgainstSchema<NaturalLanguageBriefInput>(parsed, "brief-input-v2.schema.json");
  const receipt = normalizeBrief(raw);
  await validateAgainstSchema(receipt, "brief-normalization-v2.schema.json");
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  let compilerInputPath: string | null = null;
  if (receipt.compilerInput) {
    await validateCompilerInput(receipt.compilerInput);
    compilerInputPath = join(dirname(target), `${basename(target, ".json")}.compiler-input.json`);
    await writeFile(compilerInputPath, `${JSON.stringify(receipt.compilerInput, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ outputPath: target, compilerInputPath, state: receipt.state, compilerReady: compilerInputPath !== null }));
  process.exitCode = receipt.state === "READY" ? 0 : 3;
}

try {
  await main();
} catch (error) {
  if (error instanceof ContractValidationError) {
    console.error(JSON.stringify({ state: "FAIL", kind: "CONTRACT_VALIDATION", errors: error.validationErrors }));
    process.exitCode = 1;
  } else {
    throw error;
  }
}
