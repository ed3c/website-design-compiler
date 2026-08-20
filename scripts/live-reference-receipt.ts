import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertPublicLiveReceipt, verifyLiveReferences, type LiveReferenceAdmit, type LiveReferenceReceipt } from "../src/live-reference.js";
import { validateAgainstSchema } from "../src/validate.js";

if (process.env.WDC_LIVE_REFERENCE !== "1" || process.env.WDC_REFERENCE_NETWORK !== "1") {
  throw new Error("live reference execution requires WDC_LIVE_REFERENCE=1 and WDC_REFERENCE_NETWORK=1");
}
const admitPath = process.env.WDC_LIVE_REFERENCE_ADMIT;
if (!admitPath) {
  throw new Error("WDC_LIVE_REFERENCE_ADMIT must point to a human-approved target packet");
}
const admit = JSON.parse(await readFile(resolve(admitPath), "utf8")) as LiveReferenceAdmit;
await validateAgainstSchema(admit, "live-reference-admit.schema.json");

const outputDirectory = join(process.cwd(), "artifacts", "live-reference");
const outputPath = join(outputDirectory, "live-reference-receipt.json");
let previousHashes: Record<string, string> = {};
try {
  const previous = JSON.parse(await readFile(outputPath, "utf8")) as LiveReferenceReceipt;
  previousHashes = Object.fromEntries(previous.targets.flatMap((target) =>
    target.targetUrl && target.responseSha256 ? [[target.targetUrl, target.responseSha256]] : []
  ));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
const evaluation = await verifyLiveReferences(admit, { previousHashes });
const receipt = {
  ...evaluation,
  git: { sha: process.env.GITHUB_SHA ?? "UNBOUND", ref: process.env.GITHUB_REF ?? "UNBOUND" }
};
assertPublicLiveReceipt(evaluation);
await validateAgainstSchema(receipt, "live-reference-receipt.schema.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  outputPath: "artifacts/live-reference/live-reference-receipt.json",
  overall: receipt.overall,
  targetCount: receipt.targets.length,
  states: receipt.targets.map((target) => ({
    target: target.targetUrl ?? "REDACTED",
    state: target.state,
    drift: target.drift
  }))
}));
if (receipt.overall !== "PASS") process.exitCode = 1;
