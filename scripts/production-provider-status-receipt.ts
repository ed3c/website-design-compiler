import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildUnconfiguredProductionProviderStatus } from "../src/production-media-provider.js";
import { validateAgainstSchema } from "../src/validate.js";

const receipt = {...buildUnconfiguredProductionProviderStatus(),git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"}};
const directory = resolve("artifacts/media-generator");
const receiptPath = "artifacts/media-generator/production-provider-status.json";
const outputPath = resolve(receiptPath);

await validateAgainstSchema(receipt,"production-provider-status.schema.json");
await mkdir(directory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  receiptPath,
  overall: receipt.overall,
  admissionState: receipt.admissionState,
  productionReleaseEligible: receipt.productionReleaseEligible
}));
