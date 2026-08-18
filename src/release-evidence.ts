import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CAPABILITY_RECEIPT_CONTRACTS,
  type Capability,
  type CapabilityEvidence,
  type CapabilityState
} from "./release-policy-v2.js";
import { validateAgainstSchema } from "./validate.js";

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function evidenceState(value: unknown, capability: Capability): CapabilityState {
  if (value === "PASS" || value === "FAIL" || value === "ABSENT" || value === "NOT_IMPLEMENTED" || value === "NOT_EXERCISED" || value === "SKIPPED_BY_POLICY") return value;
  throw new Error(`${capability} receipt has invalid overall state`);
}

export async function readCapabilityEvidence(root: string, capability: Capability): Promise<CapabilityEvidence> {
  const contract = CAPABILITY_RECEIPT_CONTRACTS[capability];
  let bytes: Buffer;
  try {
    bytes = await readFile(join(root, contract.path));
  } catch (error) {
    if (isEnoent(error)) return {state:"ABSENT",gitSha:null,identity:null,artifactPath:contract.path,artifactSha256:null};
    throw new Error(`unable to read ${capability} receipt`, {cause:error});
  }
  let receipt: unknown;
  try {
    receipt = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`${capability} receipt is malformed JSON`, {cause:error});
  }
  await validateAgainstSchema(receipt, contract.schemaFile, root);
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error(`${capability} receipt must be an object`);
  const record = receipt as {schema?:unknown;overall?:unknown;git?:{sha?:unknown}};
  if (record.schema !== contract.identity) throw new Error(`${capability} receipt schema identity mismatch`);
  if (!record.git || typeof record.git.sha !== "string") throw new Error(`${capability} receipt has no git SHA`);
  return {
    state:evidenceState(record.overall,capability),
    gitSha:record.git.sha,
    identity:record.schema,
    artifactPath:contract.path,
    artifactSha256:createHash("sha256").update(bytes).digest("hex")
  };
}
