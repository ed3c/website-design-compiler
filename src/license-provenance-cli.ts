#!/usr/bin/env node
import { resolve } from "node:path";
import { scanWorkspace, writeLicenseReceipt } from "./license-provenance.js";

const [packageJson, lockfile, rightsEvidence, output] = process.argv.slice(2);
if (!packageJson || !lockfile || !rightsEvidence || !output) {
  console.error("usage: license-provenance <package.json> <pnpm-lock.yaml> <rights-evidence.json> <output.json>");
  process.exitCode = 2;
} else {
  const receipt = await scanWorkspace(resolve(packageJson), resolve(lockfile), resolve(rightsEvidence));
  await writeLicenseReceipt(receipt, resolve(output));
  console.log(JSON.stringify({ output: resolve(output), overall: receipt.overall, reviewQueue: receipt.reviewQueue }));
  process.exitCode = receipt.overall === "FAIL" ? 1 : 0;
}
