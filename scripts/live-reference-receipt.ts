import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildLiveReferenceReceipt } from "../src/live-reference.js";
import { validateAgainstSchema } from "../src/validate.js";

const targets = process.argv.slice(2);
const receipt = await buildLiveReferenceReceipt(targets);
await validateAgainstSchema(receipt, "live-reference-receipt.schema.json");

const outputDirectory = join(process.cwd(), "artifacts", "live-reference");
const outputPath = join(outputDirectory, "live-reference-receipt.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  receiptPath: "artifacts/live-reference/live-reference-receipt.json",
  overall: receipt.overall,
  targetCount: receipt.targets.length
}));

if (receipt.overall !== "PASS") process.exitCode = 1;
