import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeBrief, type NaturalLanguageBriefInput } from "../src/brief-normalizer.js";
import { validateAgainstSchema } from "../src/validate.js";

const inputs = JSON.parse(await readFile(resolve("fixtures/v2/brief-benchmarks.json"), "utf8")) as NaturalLanguageBriefInput[];
const results = [];
for (const input of inputs) {
  await validateAgainstSchema(input, "brief-input-v2.schema.json");
  const receipt = normalizeBrief(input);
  await validateAgainstSchema(receipt, "brief-normalization-v2.schema.json");
  results.push({
    project: receipt.project,
    state: receipt.state,
    pageType: receipt.fields.pageType.value,
    inputSha256: receipt.inputSha256,
    structuredContractSha256: receipt.structuredContractSha256,
    normalizer: receipt.normalizer,
    validationErrors: receipt.validationErrors,
    hardConstraints: receipt.hardConstraints
  });
}

const pageTypes = new Set(results.map((result) => result.pageType));
const overall = inputs.length >= 6 && results.every((result) => result.state === "READY" && result.structuredContractSha256 && result.validationErrors.length === 0) && pageTypes.size >= 6 ? "PASS" : "FAIL";
const output = {
  schema: "website-design-compiler/brief-benchmark-receipt/v2",
  overall,
  benchmarkCount: results.length,
  distinctPageTypes: pageTypes.size,
  results
};
await mkdir(resolve("artifacts/v2/brief-benchmarks"), { recursive: true });
await writeFile(resolve("artifacts/v2/brief-benchmarks/receipt.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ overall, benchmarkCount: results.length, distinctPageTypes: pageTypes.size }));
if (overall !== "PASS") process.exitCode = 1;
