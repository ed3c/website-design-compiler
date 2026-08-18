import type { SignedMediaRequest } from "./media-router.js";
import type { RepositoryClearanceReceipt } from "./repository-rights-clearance.js";
import type { ProductionAdmissionPacket } from "./production-provider-admission.js";
import {
  buildConfiguredProductionProviderStatus,
  routeProductionMediaGeneration,
  type ProductionProviderPolicy
} from "./production-media-provider.js";
import {
  createHttpProductionProviderTransport,
  validateHttpProductionProviderAdapterConfig,
  type HttpProductionProviderAdapterConfig
} from "./production-provider-http-adapter.js";
import type { PinnedTransport } from "./pinned-http-transport.js";

export interface ProductionProviderExecutionConfig {
  schema: "website-design-compiler/production-provider-execution-config/v1";
  signedRequestPath: string;
  policyPath: string;
  rightsReceiptPath: string;
  admissionPacketPath: string;
  admissionAuthority: { authorityId: string; publicKeyPath: string };
  adapter: HttpProductionProviderAdapterConfig;
  requestSecretEnv: string;
  credentialEnv: string;
}

const safeEnvironmentName = /^[A-Z][A-Z0-9_]{2,63}$/;
const reservedEnvironmentNames = new Set(["HOME", "PATH", "SHELL", "USER", "TMPDIR", "PWD", "OLDPWD"]);
const relativeFilePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

export function validateProductionProviderExecutionConfig(config: ProductionProviderExecutionConfig): string[] {
  const errors: string[] = [];
  if (config.schema !== "website-design-compiler/production-provider-execution-config/v1") errors.push("production execution config schema is invalid");
  for (const key of ["signedRequestPath", "policyPath", "rightsReceiptPath", "admissionPacketPath"] as const) {
    if (!relativeFilePath.test(config[key])) errors.push(`${key} must be a safe relative file path`);
  }
  if (!relativeFilePath.test(config.admissionAuthority.publicKeyPath)) errors.push("admission authority publicKeyPath must be a safe relative file path");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/.test(config.admissionAuthority.authorityId)) errors.push("admission authorityId is invalid");
  for (const key of ["requestSecretEnv", "credentialEnv"] as const) {
    const value = config[key];
    if (!safeEnvironmentName.test(value) || reservedEnvironmentNames.has(value)) errors.push(`${key} must name a dedicated safe environment variable`);
  }
  if (config.requestSecretEnv === config.credentialEnv) errors.push("request signing secret and provider credential must use separate environment variables");
  errors.push(...validateHttpProductionProviderAdapterConfig(config.adapter));
  return errors;
}

export async function executeProductionProviderConfiguration(args: {
  config: ProductionProviderExecutionConfig;
  signed: SignedMediaRequest;
  policy: ProductionProviderPolicy;
  rightsReceipt: RepositoryClearanceReceipt;
  admissionPacket: ProductionAdmissionPacket;
  admissionPublicKeyPem: string;
  requestSecret: string;
  providerCredential: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname:string)=>Promise<string[]>;
  pinnedTransport?: PinnedTransport;
}) {
  const errors = validateProductionProviderExecutionConfig(args.config);
  if (errors.length > 0) throw new Error(`invalid production provider execution config: ${errors.join("; ")}`);
  const transport = createHttpProductionProviderTransport({
    config: args.config.adapter,
    credential: args.providerCredential,
    ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
    ...(args.resolveHost ? { resolveHost: args.resolveHost } : {}),
    ...(args.pinnedTransport ? { pinnedTransport: args.pinnedTransport } : {})
  });
  const result = await routeProductionMediaGeneration({
    signed: args.signed,
    secret: args.requestSecret,
    policy: args.policy,
    rightsReceipt: args.rightsReceipt,
    transport,
    executionAdmission: args.admissionPacket,
    admissionAuthorities: [{
      authorityId: args.config.admissionAuthority.authorityId,
      publicKeyPem: args.admissionPublicKeyPem
    }],
    ...(args.now ? { now: args.now } : {})
  });
  return {
    ...result,
    status: buildConfiguredProductionProviderStatus({
      receipt: result.receipt,
      rightsReceipt: args.rightsReceipt,
      runtimeCredentialsAvailable: args.providerCredential.length > 0
    })
  };
}
