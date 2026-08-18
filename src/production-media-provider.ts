import type { MediaAdapter, MediaAsset, MediaKind, SignedMediaRequest } from "./media-router.js";
import { canonicalMediaValue, sha256, verifyMediaRequest } from "./media-router.js";
import { validateRepositoryClearanceReceipt, type RepositoryClearanceReceipt } from "./repository-rights-clearance.js";
import { MediaAssetContentError, validateProductionMediaAssetContent } from "./media-asset-validation.js";
import {
  productionAdmissionPacketSha256,
  validateProductionAdmissionPacket,
  type ProductionAdmissionAuthority,
  type ProductionAdmissionPacket
} from "./production-provider-admission.js";

export interface ProductionProviderIdentity {
  providerId: string;
  serviceRevision: string;
  modelId: string;
  modelRevision: string;
  adapter: Exclude<MediaAdapter, "mock">;
  kind: MediaKind;
}

export interface ProductionProviderPolicy {
  schema: "website-design-compiler/production-provider-policy/v1";
  identity: ProductionProviderIdentity;
  rights: {
    modelWeight: { subjectId: string; expectedIdentity: string };
    generatedOutput: { subjectId: string; expectedIdentity: string };
    hostedService: { subjectId: string; expectedIdentity: string };
  };
  controls: {
    timeoutMs: number;
    maxAttempts: number;
    retryBackoffMs: number;
    requestsPerWindow: number;
    quotaUnitsPerRequest: number;
  };
  revocations: Array<{
    providerId: string;
    modelId: string;
    modelRevision: string;
    reason: string;
    effectiveAt: string;
  }>;
}

export interface ProductionProviderTransportResult {
  asset: MediaAsset;
  providerRequestId: string;
  seed: string | number | null;
  postProcessing: Array<{ operation: string; revision: string }>;
}

export interface ProductionProviderTransport {
  identity: ProductionProviderIdentity;
  configurationSha256?: string;
  generate(args: {
    request: SignedMediaRequest["request"];
    signal: AbortSignal;
    attempt: number;
  }): Promise<ProductionProviderTransportResult>;
}

export type ProductionProviderErrorCode = "OUTAGE" | "RATE_LIMIT" | "QUOTA" | "TIMEOUT" | "CANCELLED" | "INVALID_RESPONSE";

export class ProductionProviderError extends Error {
  constructor(
    readonly code: ProductionProviderErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProductionProviderError";
  }
}

class ProviderReceiptValidationError extends Error {}

function providerFailureReason(error: unknown, timeoutMs: number): string {
  if (error instanceof ProviderReceiptValidationError) return error.message;
  if (error instanceof MediaAssetContentError) return error.message;
  if (!(error instanceof ProductionProviderError)) return "production provider failed";
  const reasons: Record<ProductionProviderErrorCode, string> = {
    OUTAGE: "production provider outage",
    RATE_LIMIT: "production provider rate limited",
    QUOTA: "production provider quota exhausted",
    TIMEOUT: `production provider timed out after ${timeoutMs}ms`,
    CANCELLED: "production provider cancelled",
    INVALID_RESPONSE: "production provider response failed validation"
  };
  return reasons[error.code];
}

export interface ProductionProviderReceipt {
  schema: "website-design-compiler/production-provider-receipt/v2";
  gate: "PRODUCTION_PROVIDER";
  overall: "PASS" | "FAIL" | "NOT_EXERCISED";
  admissionState: "ADMITTED" | "NEEDS_HUMAN_ADMIT" | "DENIED" | "REVOKED";
  productionReleaseEligible: boolean;
  requestId: string;
  provider: ProductionProviderIdentity;
  requestSha256: string;
  promptSha256: string;
  configurationSha256: string;
  executionInputSha256: string | "ABSENT";
  attempts: number;
  admissionEvidence: {
    humanAdmissionReceiptId: string | "ABSENT";
    admissionPacketSha256: string | "ABSENT";
    admissionAuthorityKeySha256: string | "ABSENT";
    transportSha256: string | "ABSENT";
    repositoryRightsGeneratedAt: string;
    rightsSubjectIds: string[];
    rightsSubjects: Array<{
      id: string;
      state: string;
      versionOrIdentitySha256: string;
      attributionRequired: boolean;
      geographicRestrictionsSha256: string | "ABSENT";
      usageRestrictionsSha256: string | "ABSENT";
    }>;
    credentials: "AVAILABLE" | "ABSENT";
    budget: "AUTHORIZED" | "NOT_AUTHORIZED";
  };
  asset?: {
    sha256: string;
    bytes: number;
    mediaType: string;
    extension: string;
    format: string;
    width: number | null;
    height: number | null;
    validation: "CONTENT_VALIDATION_PASS";
  };
  provenance?: {
    providerRequestId: string;
    promptConfigurationSha256: string;
    seed: string | number | null;
    postProcessing: Array<{ operation: string; revision: string }>;
  };
  revocation?: {
    effectiveAt: string;
    reasonSha256: string;
  };
  reason: string;
}

export interface ProductionProviderStatusReceipt {
  schema: "website-design-compiler/production-provider-status/v2";
  gate: "PRODUCTION_PROVIDER";
  overall: "PASS" | "FAIL" | "NOT_EXERCISED";
  admissionState: "ADMITTED" | "NEEDS_HUMAN_ADMIT" | "DENIED" | "REVOKED";
  productionReleaseEligible: boolean;
  providerIdentity: `sha256:${string}` | "ABSENT";
  modelIdentity: `sha256:${string}` | "ABSENT";
  rightsClearance: "PASS" | "FAIL" | "ABSENT";
  runtimeCredentials: "AVAILABLE" | "ABSENT";
  budgetAuthorization: "AUTHORIZED" | "ABSENT";
  deterministicMockGate: "SEPARATE";
  executionReceiptSha256: string | "ABSENT";
  requestSha256: string | "ABSENT";
  assetSha256: string | "ABSENT";
  reason: string;
}

export function buildUnconfiguredProductionProviderStatus(reason?: string): ProductionProviderStatusReceipt {
  return {
    schema: "website-design-compiler/production-provider-status/v2",
    gate: "PRODUCTION_PROVIDER",
    overall: "NOT_EXERCISED",
    admissionState: "NEEDS_HUMAN_ADMIT",
    productionReleaseEligible: false,
    providerIdentity: "ABSENT",
    modelIdentity: "ABSENT",
    rightsClearance: "ABSENT",
    runtimeCredentials: "ABSENT",
    budgetAuthorization: "ABSENT",
    deterministicMockGate: "SEPARATE",
    executionReceiptSha256: "ABSENT",
    requestSha256: "ABSENT",
    assetSha256: "ABSENT",
    reason: reason ?? "production credentials, budget authorization, rights evidence, and human admission are absent"
  };
}

export function buildConfiguredProductionProviderStatus(args: {
  receipt: ProductionProviderReceipt;
  rightsReceipt: RepositoryClearanceReceipt;
  runtimeCredentialsAvailable: boolean;
}): ProductionProviderStatusReceipt {
  const modelIdentity = {
    modelId: args.receipt.provider.modelId,
    modelRevision: args.receipt.provider.modelRevision,
    kind: args.receipt.provider.kind
  };
  return {
    schema: "website-design-compiler/production-provider-status/v2",
    gate: "PRODUCTION_PROVIDER",
    overall: args.receipt.overall,
    admissionState: args.receipt.admissionState,
    productionReleaseEligible: args.receipt.productionReleaseEligible,
    providerIdentity: `sha256:${sha256(canonicalMediaValue(args.receipt.provider))}`,
    modelIdentity: `sha256:${sha256(canonicalMediaValue(modelIdentity))}`,
    rightsClearance: args.rightsReceipt.overall === "PASS" ? "PASS" : "FAIL",
    runtimeCredentials: args.runtimeCredentialsAvailable ? "AVAILABLE" : "ABSENT",
    budgetAuthorization: args.receipt.admissionEvidence.budget === "AUTHORIZED" ? "AUTHORIZED" : "ABSENT",
    deterministicMockGate: "SEPARATE",
    executionReceiptSha256: sha256(canonicalMediaValue(args.receipt)),
    requestSha256: args.receipt.requestSha256,
    assetSha256: args.receipt.asset?.sha256 ?? "ABSENT",
    reason: args.receipt.reason
  };
}

function isNonemptyIdentity(value: string): boolean {
  return value.trim().length > 0;
}

function isSafeOpaqueId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/.test(value);
}

function safeReceiptOpaque(value: string): string {
  return isSafeOpaqueId(value) ? value : `sha256:${sha256(value)}`;
}

function isVersionRevision(value: string): boolean {
  return /^version:v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function isDigestOrCommitRevision(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/i.test(value) || /^commit:[a-f0-9]{40}$/i.test(value);
}

function isDateRevision(value: string): boolean {
  const match = /^date:(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!match?.[1]) return false;
  const milliseconds = Date.parse(`${match[1]}T00:00:00.000Z`);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === match[1];
}

function isModelRevision(value: string): boolean {
  return isDigestOrCommitRevision(value) || isVersionRevision(value);
}

function isServiceRevision(value: string): boolean {
  return isDigestOrCommitRevision(value) || isVersionRevision(value) || isDateRevision(value);
}

function isIsoTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isMediaAssetCompatible(kind: MediaKind, mediaType: string, extension: string): boolean {
  const allowedFormats: Record<MediaKind, Set<string>> = {
    image: new Set([
      "image/avif:avif",
      "image/gif:gif",
      "image/jpeg:jpeg",
      "image/jpeg:jpg",
      "image/png:png",
      "image/svg+xml:svg",
      "image/webp:webp"
    ]),
    video: new Set([
      "video/mp4:mp4",
      "video/ogg:ogv",
      "video/quicktime:mov",
      "video/webm:webm"
    ]),
    "3d": new Set([
      "model/gltf+json:gltf",
      "model/gltf-binary:glb",
      "model/vnd.usdz+zip:usdz",
      "application/sla:stl"
    ])
  };
  return allowedFormats[kind].has(`${mediaType.toLowerCase()}:${extension.toLowerCase()}`);
}

export function validateProductionMediaRequest(request: SignedMediaRequest["request"]): string[] {
  const errors: string[] = [];
  if (request.schema !== "website-design-compiler/media-request/v1") errors.push("request schema is invalid");
  if (!isSafeOpaqueId(request.requestId)) errors.push("requestId must be a safe opaque identity");
  if (request.kind !== "image" && request.kind !== "video" && request.kind !== "3d") errors.push("request kind is invalid");
  if (!isSafeOpaqueId(request.modelId)) errors.push("request modelId must be a safe opaque identity");
  if (typeof request.prompt !== "string" || request.prompt.trim().length === 0 || request.prompt.length > 10_000) {
    errors.push("request prompt must be a non-empty bounded string");
  }
  if (!request.parameters || typeof request.parameters !== "object" || Array.isArray(request.parameters)) {
    errors.push("request parameters must be an object");
  } else {
    const entries = Object.entries(request.parameters);
    if (entries.length > 64) errors.push("request parameters exceed the admitted field count");
    for (const [key, value] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key)) errors.push(`request parameter ${key} has an invalid key`);
      if (typeof value === "number" && !Number.isFinite(value)) errors.push(`request parameter ${key} must be finite`);
      if (typeof value === "string" && value.length > 4096) errors.push(`request parameter ${key} exceeds the string budget`);
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") errors.push(`request parameter ${key} has an invalid value`);
    }
    for (const dimension of ["width", "height"] as const) {
      const value = request.parameters[dimension];
      if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 16_384)) {
        errors.push(`request ${dimension} must be a positive safe pixel dimension`);
      }
    }
  }
  if (
    !request.optimization ||
    request.optimization.target !== "web" ||
    !Number.isSafeInteger(request.optimization.maxBytes) ||
    request.optimization.maxBytes < 1 ||
    request.optimization.maxBytes > 33_554_432
  ) {
    errors.push("request optimization must target web with maxBytes between 1 and 33554432");
  }
  return errors;
}

export function productionRightsIdentities(identity: ProductionProviderIdentity): {
  modelWeight: string;
  generatedOutput: string;
  hostedService: string;
} {
  return {
    modelWeight: identity.modelRevision,
    generatedOutput: `${identity.providerId}@${identity.serviceRevision}/${identity.modelId}@${identity.modelRevision}`,
    hostedService: `${identity.providerId}@${identity.serviceRevision}`
  };
}

export function productionRightsAdmissionSha256(
  receipt: RepositoryClearanceReceipt,
  policy: ProductionProviderPolicy
): string {
  const projection = (["modelWeight", "generatedOutput", "hostedService"] as const).map((role) => {
    const binding = policy.rights[role];
    const subject = receipt.subjects.find((candidate) => candidate.id === binding.subjectId);
    return {
      role,
      subjectId: binding.subjectId,
      expectedIdentity: binding.expectedIdentity,
      subject: subject
        ? {
            id: subject.id,
            kind: subject.kind,
            name: subject.name,
            versionOrIdentity: subject.versionOrIdentity,
            licenseExpression: subject.licenseExpression,
            state: subject.state,
            evidence: [...subject.evidence].sort(),
            attributionRequired: subject.attributionRequired,
            distributed: subject.distributed,
            geographicRestrictions: [...(subject.geographicRestrictions ?? [])].sort(),
            usageRestrictions: [...(subject.usageRestrictions ?? [])].sort()
          }
        : null
    };
  });
  return sha256(canonicalMediaValue({
    schema: "website-design-compiler/production-rights-admission-projection/v1",
    subjects: projection
  }));
}

export function validateProductionProviderPolicy(policy: ProductionProviderPolicy): string[] {
  const errors: string[] = [];
  if (!isSafeOpaqueId(policy.identity.providerId)) errors.push("providerId must be a safe opaque identity");
  if (!isSafeOpaqueId(policy.identity.modelId)) errors.push("modelId must be a safe opaque identity");
  if (!isServiceRevision(policy.identity.serviceRevision)) errors.push("serviceRevision must be an exact immutable revision");
  if (!isModelRevision(policy.identity.modelRevision)) errors.push("modelRevision must be an exact immutable revision");
  const expectedAdapter: Record<MediaKind, Exclude<MediaAdapter, "mock">> = {
    image: "diffusers-image",
    video: "diffusers-video",
    "3d": "three-d-worker"
  };
  if (policy.identity.adapter !== expectedAdapter[policy.identity.kind]) {
    errors.push(`${policy.identity.kind} provider must use the ${expectedAdapter[policy.identity.kind]} isolated adapter`);
  }
  for (const [label, binding] of Object.entries(policy.rights)) {
    if (!isSafeOpaqueId(binding.subjectId)) errors.push(`${label} subjectId must be a safe opaque identity`);
    if (!isNonemptyIdentity(binding.expectedIdentity)) errors.push(`${label} expectedIdentity must be exact`);
  }
  const expectedRights = productionRightsIdentities(policy.identity);
  for (const label of ["modelWeight", "generatedOutput", "hostedService"] as const) {
    if (policy.rights[label].expectedIdentity !== expectedRights[label]) {
      errors.push(`${label} expectedIdentity must bind the exact model revision and provider service identity`);
    }
  }
  const subjectIds = Object.values(policy.rights).map((binding) => binding.subjectId).filter(Boolean);
  if (new Set(subjectIds).size !== subjectIds.length) errors.push("rights subjectId values must be distinct");
  for (const field of ["timeoutMs", "maxAttempts", "requestsPerWindow", "quotaUnitsPerRequest"] as const) {
    const value = policy.controls[field];
    if (!Number.isInteger(value) || value < 1) errors.push(`${field} must be a positive integer`);
  }
  if (!Number.isInteger(policy.controls.retryBackoffMs) || policy.controls.retryBackoffMs < 0) {
    errors.push("retryBackoffMs must be a non-negative integer");
  }
  for (const [index, revocation] of policy.revocations.entries()) {
    if (!revocation.reason.trim()) errors.push(`revocation ${index} reason is required`);
    if (!isIsoTimestamp(revocation.effectiveAt)) errors.push(`revocation ${index} effectiveAt must be an ISO timestamp`);
    if (!isSafeOpaqueId(revocation.providerId) || !isSafeOpaqueId(revocation.modelId) || !isModelRevision(revocation.modelRevision)) {
      errors.push(`revocation ${index} must bind an exact provider/model/revision identity`);
    }
  }
  return errors;
}

export async function routeProductionMediaGeneration(args: {
  signed: SignedMediaRequest;
  secret: string;
  policy: ProductionProviderPolicy;
  rightsReceipt: RepositoryClearanceReceipt;
  transport: ProductionProviderTransport;
  executionAdmission?: ProductionAdmissionPacket;
  admissionAuthorities?: readonly ProductionAdmissionAuthority[];
  now?: Date;
  sleep?: (milliseconds: number) => Promise<void>;
  cancelled?: () => boolean;
  signal?: AbortSignal;
  executionInputSha256?: string;
}): Promise<{ receipt: ProductionProviderReceipt; asset?: MediaAsset }> {
  const request = args.signed.request;
  const receiptProvider: ProductionProviderIdentity = {
    ...args.policy.identity,
    providerId: safeReceiptOpaque(args.policy.identity.providerId),
    serviceRevision: isServiceRevision(args.policy.identity.serviceRevision)
      ? args.policy.identity.serviceRevision
      : `sha256:${sha256(args.policy.identity.serviceRevision)}`,
    modelId: safeReceiptOpaque(args.policy.identity.modelId),
    modelRevision: isModelRevision(args.policy.identity.modelRevision)
      ? args.policy.identity.modelRevision
      : `sha256:${sha256(args.policy.identity.modelRevision)}`
  };
  const rightsSubjectIds = [
    args.policy.rights.modelWeight.subjectId,
    args.policy.rights.generatedOutput.subjectId,
    args.policy.rights.hostedService.subjectId
  ];
  const requestSha256 = sha256(canonicalMediaValue(request));
  const providerIdentitySha256 = sha256(canonicalMediaValue(args.policy.identity));
  const modelIdentitySha256 = sha256(canonicalMediaValue({
    modelId: args.policy.identity.modelId,
    modelRevision: args.policy.identity.modelRevision,
    kind: args.policy.identity.kind
  }));
  const policySha256 = sha256(canonicalMediaValue(args.policy));
  const rightsReceiptSha256 = productionRightsAdmissionSha256(args.rightsReceipt, args.policy);
  const base: ProductionProviderReceipt = {
    schema: "website-design-compiler/production-provider-receipt/v2",
    gate: "PRODUCTION_PROVIDER",
    overall: "NOT_EXERCISED",
    admissionState: "NEEDS_HUMAN_ADMIT",
    productionReleaseEligible: false,
    requestId: safeReceiptOpaque(request.requestId),
    provider: receiptProvider,
    requestSha256,
    promptSha256: sha256(typeof request.prompt === "string" ? request.prompt : canonicalMediaValue(request.prompt)),
    configurationSha256: sha256(canonicalMediaValue({ prompt: request.prompt, parameters: request.parameters })),
    executionInputSha256: args.executionInputSha256 && /^[a-f0-9]{64}$/.test(args.executionInputSha256) ? args.executionInputSha256 : "ABSENT",
    attempts: 0,
    admissionEvidence: {
      humanAdmissionReceiptId: args.executionAdmission?.admissionId
        ? safeReceiptOpaque(args.executionAdmission.admissionId)
        : "ABSENT",
      admissionPacketSha256: args.executionAdmission
        ? productionAdmissionPacketSha256(args.executionAdmission)
        : "ABSENT",
      admissionAuthorityKeySha256: args.executionAdmission && /^[a-f0-9]{64}$/.test(args.executionAdmission.authorityKeySha256)
        ? args.executionAdmission.authorityKeySha256
        : "ABSENT",
      transportSha256: args.executionAdmission && /^[a-f0-9]{64}$/.test(args.executionAdmission.transportSha256)
        ? args.executionAdmission.transportSha256
        : "ABSENT",
      repositoryRightsGeneratedAt: isIsoTimestamp(args.rightsReceipt.generatedAt)
        ? args.rightsReceipt.generatedAt
        : "INVALID",
      rightsSubjectIds: rightsSubjectIds.map(safeReceiptOpaque),
      rightsSubjects: rightsSubjectIds.map((subjectId) => {
        const subject = args.rightsReceipt.subjects.find((entry) => entry.id === subjectId);
        return {
          id: safeReceiptOpaque(subjectId),
          state: subject?.state ?? "ABSENT",
          versionOrIdentitySha256: sha256(subject?.versionOrIdentity ?? "ABSENT"),
          attributionRequired: subject?.attributionRequired ?? false,
          geographicRestrictionsSha256: subject?.geographicRestrictions
            ? sha256(canonicalMediaValue(subject.geographicRestrictions))
            : "ABSENT",
          usageRestrictionsSha256: subject?.usageRestrictions
            ? sha256(canonicalMediaValue(subject.usageRestrictions))
            : "ABSENT"
        };
      }),
      credentials: args.executionAdmission?.credentials === "AVAILABLE" ? "AVAILABLE" : "ABSENT",
      budget: args.executionAdmission?.budget === "AUTHORIZED" ? "AUTHORIZED" : "NOT_AUTHORIZED"
    },
    reason: "production provider requires human admission, available credentials, and authorized budget"
  };

  const requestErrors = validateProductionMediaRequest(request);
  if (requestErrors.length > 0) {
    return {
      receipt: {
        ...base,
        overall: "FAIL",
        admissionState: "DENIED",
        reason: `invalid production media request: ${requestErrors.join("; ")}`
      }
    };
  }

  const policyErrors = validateProductionProviderPolicy(args.policy);
  if (policyErrors.length > 0) {
    return {
      receipt: {
        ...base,
        overall: "FAIL",
        admissionState: "DENIED",
        reason: `invalid production provider policy: ${policyErrors.join("; ")}`
      }
    };
  }

  const rightsErrors = validateRepositoryClearanceReceipt(args.rightsReceipt);
  if (rightsErrors.length > 0) {
    return {
      receipt: {
        ...base,
        overall: "FAIL",
        admissionState: "DENIED",
        reason: `repository rights receipt is invalid: ${rightsErrors.join("; ")}`
      }
    };
  }

  const admission = args.executionAdmission;
  if (!admission) {
    return { receipt: base };
  }
  const admissionErrors = validateProductionAdmissionPacket({
    packet: admission,
    expected: {
      requestSha256,
      providerIdentitySha256,
      transportSha256: args.transport.configurationSha256 ?? providerIdentitySha256,
      modelIdentitySha256,
      policySha256,
      rightsReceiptSha256
    },
    authorities: args.admissionAuthorities ?? [],
    now: args.now ?? new Date()
  });
  if (admissionErrors.length > 0) {
    return {
      receipt: {
        ...base,
        overall: "FAIL",
        admissionState: "DENIED",
        reason: `invalid production admission: ${admissionErrors.join("; ")}`
      }
    };
  }

  if (!verifyMediaRequest(args.signed, args.secret)) {
    return {
      receipt: {
        ...base,
        overall: "FAIL",
        admissionState: "DENIED",
        reason: "production media request authentication failed"
      }
    };
  }

  const revocation = args.policy.revocations.find((entry) =>
    entry.providerId === args.policy.identity.providerId &&
    entry.modelId === args.policy.identity.modelId &&
    entry.modelRevision === args.policy.identity.modelRevision &&
    new Date(entry.effectiveAt).getTime() <= (args.now ?? new Date()).getTime()
  );
  if (revocation) {
    return {
      receipt: {
        ...base,
        admissionState: "REVOKED",
        reason: "provider identity revoked by policy",
        revocation: {
          effectiveAt: revocation.effectiveAt,
          reasonSha256: sha256(revocation.reason)
        }
      }
    };
  }

  const rightsBindings = [
    { label: "model-weight", kind: "model", ...args.policy.rights.modelWeight },
    { label: "generated-output", kind: "generated-output", ...args.policy.rights.generatedOutput },
    { label: "hosted-service", kind: "service", ...args.policy.rights.hostedService }
  ] as const;
  for (const binding of rightsBindings) {
    const subject = args.rightsReceipt.subjects.find((entry) => entry.id === binding.subjectId);
    if (!subject) {
      return {
        receipt: {
          ...base,
          admissionState: "DENIED",
          reason: `${binding.label} rights subject ${binding.subjectId} is ABSENT`
        }
      };
    }
    if (subject.kind !== binding.kind || subject.versionOrIdentity !== binding.expectedIdentity) {
      return {
        receipt: {
          ...base,
          admissionState: "DENIED",
          reason: `${binding.label} rights subject ${binding.subjectId} does not match the admitted identity`
        }
      };
    }
    if (!Array.isArray(subject.geographicRestrictions) || !Array.isArray(subject.usageRestrictions)) {
      return {
        receipt: {
          ...base,
          admissionState: "DENIED",
          reason: `${binding.subjectId} geographic and usage restriction declarations are ABSENT`
        }
      };
    }
    if (subject.state !== "ALLOW") {
      return {
        receipt: {
          ...base,
          admissionState: "DENIED",
          reason: `${binding.subjectId} rights state is ${subject.state}`
        }
      };
    }
  }
  if (args.rightsReceipt.overall !== "PASS") {
    return {
      receipt: {
        ...base,
        admissionState: "DENIED",
        reason: "repository-wide rights clearance is not PASS"
      }
    };
  }

  if (canonicalMediaValue(args.transport.identity) !== canonicalMediaValue(args.policy.identity)) {
    return {
      receipt: {
        ...base,
        admissionState: "DENIED",
        reason: "isolated provider transport identity does not match admitted policy identity"
      }
    };
  }
  if (request.modelId !== args.policy.identity.modelId || request.kind !== args.policy.identity.kind) {
    return {
      receipt: {
        ...base,
        admissionState: "DENIED",
        reason: "request model or kind does not match admitted provider identity"
      }
    };
  }
  if (admission.rateLimitRemaining < 1) {
    return {
      receipt: {
        ...base,
        admissionState: "DENIED",
        reason: "provider rate limit has no remaining request capacity"
      }
    };
  }
  if (admission.quotaUnitsRemaining < args.policy.controls.quotaUnitsPerRequest) {
    return {
      receipt: {
        ...base,
        admissionState: "DENIED",
        reason: "provider quota is insufficient for this request"
      }
    };
  }

  let lastError = "production provider failed";
  for (let attempt = 1; attempt <= args.policy.controls.maxAttempts; attempt += 1) {
    const capacityStops: string[] = [];
    if (attempt > Math.min(admission.rateLimitRemaining, args.policy.controls.requestsPerWindow)) {
      capacityStops.push("rate-limit");
    }
    if (attempt * args.policy.controls.quotaUnitsPerRequest > admission.quotaUnitsRemaining) {
      capacityStops.push("quota");
    }
    if (capacityStops.length > 0) {
      return {
        receipt: {
          ...base,
          overall: attempt === 1 ? "NOT_EXERCISED" : "FAIL",
          admissionState: "ADMITTED",
          attempts: attempt - 1,
          reason: `${attempt === 1 ? "execution" : "retry"} blocked by admitted ${capacityStops.join(" and ")} capacity`
        }
      };
    }
    if (args.cancelled?.() || args.signal?.aborted) {
      return {
        receipt: {
          ...base,
          overall: attempt === 1 ? "NOT_EXERCISED" : "FAIL",
          admissionState: "ADMITTED",
          attempts: attempt - 1,
          reason: "production generation cancelled before provider execution"
        }
      };
    }
    const controller = new AbortController();
    try {
      const generated = await new Promise<ProductionProviderTransportResult>((resolve, reject) => {
        const cleanup = () => args.signal?.removeEventListener("abort", onExternalAbort);
        const rejectAndCleanup = (error: unknown) => {
          clearTimeout(timeout);
          cleanup();
          reject(error);
        };
        const onExternalAbort = () => {
          rejectAndCleanup(new ProductionProviderError("CANCELLED", "production provider cancelled"));
          controller.abort();
        };
        const timeout = setTimeout(() => {
          rejectAndCleanup(new ProductionProviderError(
            "TIMEOUT",
            `production provider timed out after ${args.policy.controls.timeoutMs}ms`
          ));
          controller.abort();
        }, args.policy.controls.timeoutMs);
        args.signal?.addEventListener("abort", onExternalAbort, { once: true });
        if (args.signal?.aborted) {
          onExternalAbort();
          return;
        }
        try {
          args.transport.generate({ request, signal: controller.signal, attempt }).then(
            (result) => {
              clearTimeout(timeout);
              cleanup();
              resolve(result);
            },
            rejectAndCleanup
          );
        } catch (error) {
          rejectAndCleanup(error);
        }
      });
      if (!isSafeOpaqueId(generated.providerRequestId)) {
        throw new ProviderReceiptValidationError("provider response has an unsafe providerRequestId");
      }
      if (request.parameters.seed !== undefined && generated.seed !== request.parameters.seed) {
        throw new ProviderReceiptValidationError("provider response seed does not match the requested configuration");
      }
      if (generated.postProcessing.some((entry) =>
        !isSafeOpaqueId(entry.operation) ||
        !(isDigestOrCommitRevision(entry.revision) || isVersionRevision(entry.revision) || isDateRevision(entry.revision))
      )) {
        throw new ProviderReceiptValidationError("provider response has incomplete post-processing provenance");
      }
      if (generated.asset.bytes.byteLength === 0) {
        throw new ProviderReceiptValidationError("provider response contains an empty asset");
      }
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(generated.asset.mediaType)) {
        throw new ProviderReceiptValidationError("provider response contains an invalid mediaType");
      }
      if (!/^[a-z0-9]+$/i.test(generated.asset.extension)) {
        throw new ProviderReceiptValidationError("provider response contains an invalid extension");
      }
      if (!isMediaAssetCompatible(request.kind, generated.asset.mediaType, generated.asset.extension)) {
        throw new ProviderReceiptValidationError(`provider response mediaType and extension are incompatible with requested ${request.kind} media`);
      }
      if (generated.asset.bytes.byteLength > request.optimization.maxBytes) {
        throw new ProviderReceiptValidationError("generated asset exceeds optimization maxBytes");
      }
      const content = validateProductionMediaAssetContent(request.kind, generated.asset, request.parameters);
      return {
        asset: generated.asset,
        receipt: {
          ...base,
          overall: "PASS",
          admissionState: "ADMITTED",
          productionReleaseEligible: true,
          attempts: attempt,
          asset: {
            sha256: sha256(generated.asset.bytes),
            bytes: generated.asset.bytes.byteLength,
            mediaType: generated.asset.mediaType,
            extension: generated.asset.extension,
            ...content
          },
          provenance: {
            providerRequestId: generated.providerRequestId,
            promptConfigurationSha256: base.configurationSha256,
            seed: generated.seed,
            postProcessing: generated.postProcessing
          },
          reason: "production provider executed with admitted rights and complete provenance"
        }
      };
    } catch (error) {
      lastError = providerFailureReason(error, args.policy.controls.timeoutMs);
      const retryable = error instanceof ProductionProviderError &&
        (error.code === "OUTAGE" || error.code === "RATE_LIMIT" || error.code === "TIMEOUT");
      if (!retryable || attempt === args.policy.controls.maxAttempts) {
        return {
          receipt: {
            ...base,
            overall: "FAIL",
            admissionState: "ADMITTED",
            attempts: attempt,
            reason: lastError
          }
        };
      }
      await (args.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(
        args.policy.controls.retryBackoffMs
      );
    }
  }
  return {
    receipt: {
      ...base,
      overall: "FAIL",
      admissionState: "ADMITTED",
      attempts: args.policy.controls.maxAttempts,
      reason: lastError
    }
  };
}
