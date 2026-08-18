import { canonicalMediaValue, sha256, type SignedMediaRequest } from "./media-router.js";
import { validateRepositoryClearanceReceipt, type RepositoryClearanceReceipt } from "./repository-rights-clearance.js";
import { validateProductionAdmissionPacket, type ProductionAdmissionPacket } from "./production-provider-admission.js";
import {
  buildConfiguredProductionProviderStatus,
  productionRightsAdmissionSha256,
  productionRightsIdentities,
  routeProductionMediaGeneration,
  validateProductionProviderPolicy,
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
  admissionPacketPath: string;
  admissionAuthority: { authorityId: string; publicKeyPath: string };
  adapter: HttpProductionProviderAdapterConfig;
  requestSecretEnv: string;
  credentialEnv: string;
}

export const CANONICAL_REPOSITORY_RIGHTS_RECEIPT_PATH = "artifacts/rights-clearance/repository-rights-clearance.json";

export interface ProductionProviderExecutionEvidence {
  schema: "website-design-compiler/production-provider-execution-evidence/v1";
  git: { sha: string; ref: string };
  executedAt: string;
  requestBinding: {
    requestId: string;
    kind: SignedMediaRequest["request"]["kind"];
    modelId: string;
    requestSha256: string;
    promptSha256: string;
    configurationSha256: string;
    assetValidation: {
      width: number | null;
      height: number | null;
      seedSha256: string | "ABSENT";
      maxBytes: number;
    };
  };
  policy: ProductionProviderPolicy;
  adapter: HttpProductionProviderAdapterConfig;
  admissionPacket: ProductionAdmissionPacket;
  admissionAuthority: { authorityId: string; publicKeyPem: string };
  canonicalRights: { path: typeof CANONICAL_REPOSITORY_RIGHTS_RECEIPT_PATH; bytesSha256: string; canonicalValueSha256: string };
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function buildProductionProviderExecutionEvidence(args: {
  executedAt: Date;
  signed: SignedMediaRequest;
  policy: ProductionProviderPolicy;
  config: ProductionProviderExecutionConfig;
  admissionPacket: ProductionAdmissionPacket;
  admissionPublicKeyPem: string;
  rightsReceipt: RepositoryClearanceReceipt;
  rightsReceiptBytesSha256: string;
  git: { sha: string; ref: string };
}): ProductionProviderExecutionEvidence {
  const request = args.signed.request;
  return {
    schema: "website-design-compiler/production-provider-execution-evidence/v1",
    git: args.git,
    executedAt: args.executedAt.toISOString(),
    requestBinding: {
      requestId: request.requestId,
      kind: request.kind,
      modelId: request.modelId,
      requestSha256: sha256(canonicalMediaValue(request)),
      promptSha256: sha256(request.prompt),
      configurationSha256: sha256(canonicalMediaValue({ prompt: request.prompt, parameters: request.parameters })),
      assetValidation: {
        width: typeof request.parameters.width === "number" ? request.parameters.width : null,
        height: typeof request.parameters.height === "number" ? request.parameters.height : null,
        seedSha256: request.parameters.seed === undefined ? "ABSENT" : sha256(canonicalMediaValue(request.parameters.seed)),
        maxBytes: request.optimization.maxBytes
      }
    },
    policy: args.policy,
    adapter: args.config.adapter,
    admissionPacket: args.admissionPacket,
    admissionAuthority: { authorityId: args.config.admissionAuthority.authorityId, publicKeyPem: args.admissionPublicKeyPem },
    canonicalRights: {
      path: CANONICAL_REPOSITORY_RIGHTS_RECEIPT_PATH,
      bytesSha256: args.rightsReceiptBytesSha256,
      canonicalValueSha256: sha256(canonicalMediaValue(args.rightsReceipt))
    }
  };
}

export function serializeProductionProviderExecutionEvidence(evidence: ProductionProviderExecutionEvidence): Buffer {
  return Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export function validateProductionProviderExecutionEvidence(value: unknown, rightsReceipt: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value) || !exactKeys(value, ["schema", "git", "executedAt", "requestBinding", "policy", "adapter", "admissionPacket", "admissionAuthority", "canonicalRights"])) return ["production execution inputs do not match the strict evidence contract"];
  if (value.schema !== "website-design-compiler/production-provider-execution-evidence/v1") errors.push("production execution inputs schema is invalid");
  if (!isIsoTimestamp(value.executedAt)) errors.push("production execution inputs executedAt is invalid");
  const git = isRecord(value.git) && exactKeys(value.git, ["sha", "ref"]) ? value.git : null;
  if (!git || typeof git.sha !== "string" || !/^[a-f0-9]{40}$/.test(git.sha) || typeof git.ref !== "string" || !git.ref.startsWith("refs/")) errors.push("production execution Git subject is malformed");
  const requestBinding = isRecord(value.requestBinding) && exactKeys(value.requestBinding, ["requestId", "kind", "modelId", "requestSha256", "promptSha256", "configurationSha256", "assetValidation"]) ? value.requestBinding : null;
  const assetValidation = requestBinding && isRecord(requestBinding.assetValidation) && exactKeys(requestBinding.assetValidation, ["width", "height", "seedSha256", "maxBytes"]) ? requestBinding.assetValidation : null;
  const dimensionIsValid = (entry: unknown) => entry === null || (Number.isSafeInteger(entry) && Number(entry) >= 1 && Number(entry) <= 16_384);
  if (!requestBinding || typeof requestBinding.requestId !== "string" || typeof requestBinding.modelId !== "string" || !["image", "video", "3d"].includes(String(requestBinding.kind)) || !["requestSha256", "promptSha256", "configurationSha256"].every((key) => typeof requestBinding[key] === "string" && /^[a-f0-9]{64}$/.test(String(requestBinding[key]))) || !assetValidation || !dimensionIsValid(assetValidation.width) || !dimensionIsValid(assetValidation.height) || (assetValidation.seedSha256 !== "ABSENT" && (typeof assetValidation.seedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(assetValidation.seedSha256))) || !Number.isSafeInteger(assetValidation.maxBytes) || Number(assetValidation.maxBytes) < 1 || Number(assetValidation.maxBytes) > 33_554_432) errors.push("production execution request binding is malformed");
  const policy = isRecord(value.policy) ? value.policy as unknown as ProductionProviderPolicy : null;
  const adapter = isRecord(value.adapter) ? value.adapter as unknown as HttpProductionProviderAdapterConfig : null;
  const packet = isRecord(value.admissionPacket) ? value.admissionPacket as unknown as ProductionAdmissionPacket : null;
  const authority = isRecord(value.admissionAuthority) ? value.admissionAuthority : null;
  if (!policy) errors.push("production execution policy is absent");
  else errors.push(...validateProductionProviderPolicy(policy));
  if (!adapter) errors.push("production execution adapter is absent");
  else errors.push(...validateHttpProductionProviderAdapterConfig(adapter));
  if (!authority || !exactKeys(authority, ["authorityId", "publicKeyPem"]) || typeof authority.authorityId !== "string" || typeof authority.publicKeyPem !== "string" || authority.publicKeyPem.length === 0) errors.push("production admission authority is malformed");
  const rightsErrors = validateRepositoryClearanceReceipt(rightsReceipt);
  errors.push(...rightsErrors.map((error) => `repository rights: ${error}`));
  const canonicalRights = isRecord(value.canonicalRights) && exactKeys(value.canonicalRights, ["path", "bytesSha256", "canonicalValueSha256"]) ? value.canonicalRights : null;
  if (!canonicalRights || canonicalRights.path !== CANONICAL_REPOSITORY_RIGHTS_RECEIPT_PATH || !["bytesSha256", "canonicalValueSha256"].every((key) => typeof canonicalRights[key] === "string" && /^[a-f0-9]{64}$/.test(String(canonicalRights[key])))) errors.push("canonical rights binding is malformed");
  else if (isRecord(rightsReceipt) && canonicalRights.canonicalValueSha256 !== sha256(canonicalMediaValue(rightsReceipt))) errors.push("canonical rights value digest does not bind the canonical receipt");
  if (policy && adapter && canonicalMediaValue(adapter.identity) !== canonicalMediaValue(policy.identity)) errors.push("production adapter identity does not match policy identity");
  if (policy && requestBinding && (requestBinding.modelId !== policy.identity.modelId || requestBinding.kind !== policy.identity.kind)) errors.push("production request binding does not match policy identity");
  if (policy && isRecord(rightsReceipt) && Array.isArray(rightsReceipt.subjects)) {
    const expectedKinds = { modelWeight: "model", generatedOutput: "generated-output", hostedService: "service" } as const;
    const expectedIdentities = productionRightsIdentities(policy.identity);
    for (const key of ["modelWeight", "generatedOutput", "hostedService"] as const) {
      const binding = policy.rights[key];
      const subject = rightsReceipt.subjects.find((candidate) => isRecord(candidate) && candidate.id === binding.subjectId);
      if (!isRecord(subject) || subject.kind !== expectedKinds[key] || subject.versionOrIdentity !== expectedIdentities[key] || subject.state !== "ALLOW" || !Array.isArray(subject.geographicRestrictions) || !Array.isArray(subject.usageRestrictions)) errors.push(`${key} is not exact ALLOW evidence in the canonical rights receipt`);
    }
  }
  if (!packet) errors.push("production admission packet is absent");
  else if (policy && adapter && requestBinding && authority && typeof authority.authorityId === "string" && typeof authority.publicKeyPem === "string" && isIsoTimestamp(value.executedAt) && canonicalRights) {
    const modelIdentitySha256 = sha256(canonicalMediaValue({ modelId: policy.identity.modelId, modelRevision: policy.identity.modelRevision, kind: policy.identity.kind }));
    errors.push(...validateProductionAdmissionPacket({
      packet,
      expected: {
        requestSha256: String(requestBinding.requestSha256),
        providerIdentitySha256: sha256(canonicalMediaValue(policy.identity)),
        transportSha256: sha256(canonicalMediaValue(adapter)),
        modelIdentitySha256,
        policySha256: sha256(canonicalMediaValue(policy)),
        rightsReceiptSha256: productionRightsAdmissionSha256(rightsReceipt as unknown as RepositoryClearanceReceipt, policy)
      },
      authorities: [{ authorityId: authority.authorityId, publicKeyPem: authority.publicKeyPem }],
      now: new Date(value.executedAt)
    }).map((error) => `production admission: ${error}`));
  }
  return errors;
}

const safeEnvironmentName = /^[A-Z][A-Z0-9_]{2,63}$/;
const reservedEnvironmentNames = new Set(["HOME", "PATH", "SHELL", "USER", "TMPDIR", "PWD", "OLDPWD"]);
const relativeFilePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

export function validateProductionProviderExecutionConfig(config: ProductionProviderExecutionConfig): string[] {
  const errors: string[] = [];
  if (config.schema !== "website-design-compiler/production-provider-execution-config/v1") errors.push("production execution config schema is invalid");
  for (const key of ["signedRequestPath", "policyPath", "admissionPacketPath"] as const) {
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
  rightsReceiptBytesSha256: string;
  git: { sha: string; ref: string };
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
  const executedAt = args.now ?? new Date();
  const executionEvidence = buildProductionProviderExecutionEvidence({
    executedAt,
    signed: args.signed,
    policy: args.policy,
    config: args.config,
    admissionPacket: args.admissionPacket,
    admissionPublicKeyPem: args.admissionPublicKeyPem,
    rightsReceipt: args.rightsReceipt,
    rightsReceiptBytesSha256: args.rightsReceiptBytesSha256,
    git: args.git
  });
  const executionInputSha256 = sha256(serializeProductionProviderExecutionEvidence(executionEvidence));
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
    now: executedAt,
    executionInputSha256
  });
  return {
    ...result,
    executionEvidence,
    status: buildConfiguredProductionProviderStatus({
      receipt: result.receipt,
      rightsReceipt: args.rightsReceipt,
      runtimeCredentialsAvailable: args.providerCredential.length > 0
    })
  };
}
