import { createHash, createPublicKey } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalMediaValue, type SignedMediaRequest } from "./media-router.js";
import type { ProductionAdmissionPacket } from "./production-provider-admission.js";
import {
  validateProductionProviderExecutionConfig,
  type ProductionProviderExecutionConfig
} from "./production-provider-execution.js";
import {
  validateProductionMediaRequest,
  validateProductionProviderPolicy,
  type ProductionProviderPolicy
} from "./production-media-provider.js";
import { validateAgainstSchema } from "./validate.js";

export interface ProductionProviderExecutionBundle {
  schema: "website-design-compiler/production-provider-execution-bundle/v1";
  config: ProductionProviderExecutionConfig;
  signedRequest: SignedMediaRequest;
  policy: ProductionProviderPolicy;
  admissionPacket: ProductionAdmissionPacket;
  admissionPublicKeyPem: string;
}

export type MaterializedProductionProviderBundle =
  | { state: "NOT_EXERCISED"; configPath: "" }
  | { state: "MATERIALIZED"; configPath: string; bundleSha256: string };

const canonicalFiles = {
  signedRequestPath: "signed-request.json",
  policyPath: "policy.json",
  admissionPacketPath: "admission.json",
  publicKeyPath: "admission-public-key.pem"
} as const;

const canonicalEnvironment = {
  requestSecretEnv: "WDC_PRODUCTION_REQUEST_SECRET",
  credentialEnv: "WDC_PRODUCTION_PROVIDER_CREDENTIAL"
} as const;

function findForbiddenSecretField(value: unknown, path = "/"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenSecretField(value[index], `${path}${index}/`);
      if (found) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:requestSecret|providerCredential)$/i.test(key)) return `${path}${key}`;
    const found = findForbiddenSecretField(entry, `${path}${key}/`);
    if (found) return found;
  }
  return null;
}

function decodeCanonicalBase64(encoded: string): Buffer {
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("production provider bundle must use canonical base64");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== encoded) {
    throw new Error("production provider bundle must use canonical base64");
  }
  return bytes;
}

function assertCanonicalConfiguration(bundle: ProductionProviderExecutionBundle): void {
  const config = bundle.config;
  if (config.signedRequestPath !== canonicalFiles.signedRequestPath) throw new Error(`signedRequestPath must be ${canonicalFiles.signedRequestPath}`);
  if (config.policyPath !== canonicalFiles.policyPath) throw new Error(`policyPath must be ${canonicalFiles.policyPath}`);
  if (config.admissionPacketPath !== canonicalFiles.admissionPacketPath) throw new Error(`admissionPacketPath must be ${canonicalFiles.admissionPacketPath}`);
  if (config.admissionAuthority.publicKeyPath !== canonicalFiles.publicKeyPath) throw new Error(`publicKeyPath must be ${canonicalFiles.publicKeyPath}`);
  if (config.requestSecretEnv !== canonicalEnvironment.requestSecretEnv) throw new Error(`requestSecretEnv must be ${canonicalEnvironment.requestSecretEnv}`);
  if (config.credentialEnv !== canonicalEnvironment.credentialEnv) throw new Error(`credentialEnv must be ${canonicalEnvironment.credentialEnv}`);
  if (config.admissionAuthority.authorityId !== bundle.admissionPacket.approvedBy) {
    throw new Error("admission authorityId must match the packet approvedBy identity");
  }
  if (canonicalMediaValue(config.adapter.identity) !== canonicalMediaValue(bundle.policy.identity)) {
    throw new Error("production provider config identity must match the policy identity");
  }
  if (bundle.signedRequest.request.modelId !== bundle.policy.identity.modelId || bundle.signedRequest.request.kind !== bundle.policy.identity.kind) {
    throw new Error("signed request identity must match the policy identity");
  }
  const publicKey = createPublicKey(bundle.admissionPublicKeyPem);
  const authorityKeySha256 = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  if (bundle.admissionPacket.authorityKeySha256 !== authorityKeySha256) {
    throw new Error("admission public key does not match the packet authorityKeySha256");
  }
}

async function validateBundle(value: unknown): Promise<ProductionProviderExecutionBundle> {
  const forbiddenField = findForbiddenSecretField(value);
  if (forbiddenField) throw new Error(`production provider bundle contains forbidden secret field ${forbiddenField}`);
  const bundle = await validateAgainstSchema<ProductionProviderExecutionBundle>(
    value,
    "production-provider-execution-bundle.schema.json"
  );
  await Promise.all([
    validateAgainstSchema(bundle.config, "production-provider-execution-config.schema.json"),
    validateAgainstSchema(bundle.policy, "production-provider-policy.schema.json"),
    validateAgainstSchema(bundle.admissionPacket, "production-provider-admission.schema.json")
  ]);
  const errors = [
    ...validateProductionProviderExecutionConfig(bundle.config),
    ...validateProductionMediaRequest(bundle.signedRequest.request),
    ...validateProductionProviderPolicy(bundle.policy)
  ];
  if (errors.length > 0) throw new Error(`invalid production provider bundle: ${errors.join("; ")}`);
  assertCanonicalConfiguration(bundle);
  return bundle;
}

function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function materializeProductionProviderBundle(args: {
  encodedBundle?: string;
  expectedSha256?: string;
  temporaryRoot?: string;
}): Promise<MaterializedProductionProviderBundle> {
  const encodedBundle = args.encodedBundle?.trim();
  const expectedSha256 = args.expectedSha256?.trim();
  if (!encodedBundle && !expectedSha256) return { state: "NOT_EXERCISED", configPath: "" };
  if (!encodedBundle || !expectedSha256) {
    throw new Error("production provider bundle and its trusted SHA-256 must be provided together");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("production provider bundle SHA-256 is malformed");
  const bytes = decodeCanonicalBase64(encodedBundle);
  const bundleSha256 = createHash("sha256").update(bytes).digest("hex");
  if (bundleSha256 !== expectedSha256) {
    throw new Error("production provider bundle does not match the externally trusted SHA-256");
  }

  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("production provider bundle is not valid UTF-8 JSON");
  }
  const bundle = await validateBundle(value);
  const directory = await mkdtemp(join(args.temporaryRoot ?? tmpdir(), "wdc-production-provider-"));
  try {
    await Promise.all([
      writeFile(join(directory, "config.json"), serialized(bundle.config), { encoding: "utf8", mode: 0o600, flag: "wx" }),
      writeFile(join(directory, canonicalFiles.signedRequestPath), serialized(bundle.signedRequest), { encoding: "utf8", mode: 0o600, flag: "wx" }),
      writeFile(join(directory, canonicalFiles.policyPath), serialized(bundle.policy), { encoding: "utf8", mode: 0o600, flag: "wx" }),
      writeFile(join(directory, canonicalFiles.admissionPacketPath), serialized(bundle.admissionPacket), { encoding: "utf8", mode: 0o600, flag: "wx" }),
      writeFile(join(directory, canonicalFiles.publicKeyPath), bundle.admissionPublicKeyPem, { encoding: "utf8", mode: 0o600, flag: "wx" })
    ]);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { state: "MATERIALIZED", configPath: join(directory, "config.json"), bundleSha256 };
}
