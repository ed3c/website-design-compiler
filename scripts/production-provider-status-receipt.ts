import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildUnconfiguredProductionProviderStatus } from "../src/production-media-provider.js";

const receipt = buildUnconfiguredProductionProviderStatus();
const directory = resolve("artifacts/media-generator");
const receiptPath = "artifacts/media-generator/production-provider-status.json";
const outputPath = resolve(receiptPath);

await mkdir(directory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  receiptPath,
  overall: receipt.overall,
  admissionState: receipt.admissionState,
  productionReleaseEligible: receipt.productionReleaseEligible
}));
