#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeBrief, type NaturalLanguageBriefInput } from "./brief-normalizer.js";

async function main(): Promise<void> {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error("usage: brief-normalize <brief-input.json> <normalization-receipt.json>");
    process.exitCode = 2;
    return;
  }

  const raw = JSON.parse(await readFile(resolve(inputPath), "utf8")) as NaturalLanguageBriefInput;
  const receipt = normalizeBrief(raw);
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath: target, state: receipt.state, compilerReady: receipt.compilerInput !== null }));
  process.exitCode = receipt.state === "READY" ? 0 : 3;
}

await main();
