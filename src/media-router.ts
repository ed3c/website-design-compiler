import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type MediaKind = "image" | "video" | "3d";
export type MediaAdmission = "ALLOW" | "REVIEW_REQUIRED" | "DENY";
export type MediaAdapter = "mock" | "diffusers-image" | "diffusers-video" | "three-d-worker";

export interface MediaModelPolicyEntry {
  id: string;
  kind: MediaKind;
  adapter: MediaAdapter;
  admission: MediaAdmission;
  versionOrCommit: string;
  provenanceSubjectId: string;
  outputTermsSubjectId: string;
  serviceTermsSubjectId: string;
  reason?: string;
}

export interface MediaModelPolicy {
  schema: "website-design-compiler/media-model-policy/v1";
  productCoreForbiddenImports: string[];
  entries: MediaModelPolicyEntry[];
}

export interface MediaRequest {
  schema: "website-design-compiler/media-request/v1";
  requestId: string;
  kind: MediaKind;
  modelId: string;
  prompt: string;
  parameters: Record<string, string | number | boolean>;
  optimization: {
    target: "web";
    maxBytes: number;
  };
}

export interface SignedMediaRequest {
  request: MediaRequest;
  signature: string;
}

export interface MediaAsset {
  mediaType: string;
  bytes: Uint8Array;
  extension: string;
}

export interface MediaWorker {
  adapter: MediaAdapter;
  generate(request: MediaRequest): Promise<MediaAsset>;
}

export interface MediaGenerationReceipt {
  schema: "website-design-compiler/media-generation-receipt/v1";
  gate: "DETERMINISTIC_MOCK";
  productionReleaseEligible: false;
  overall: "PASS" | "FAIL";
  requestId: string;
  model: {
    id: string;
    kind: MediaKind;
    adapter: MediaAdapter;
    admission: MediaAdmission;
    versionOrCommit: string;
    provenanceSubjectId: string;
    outputTermsSubjectId: string;
    serviceTermsSubjectId: string;
  };
  requestSha256: string;
  promptSha256: string;
  parameters: Record<string, string | number | boolean>;
  asset?: {
    sha256: string;
    bytes: number;
    mediaType: string;
    extension: string;
  };
  optimization: MediaRequest["optimization"];
  queue: {
    maxAttempts: number;
    attempts: number;
    cancellation: "SUPPORTED";
  };
  reason?: string;
}

export function canonicalMediaValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalMediaValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalMediaValue(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signMediaRequest(request: MediaRequest, secret: string): string {
  return createHmac("sha256", secret).update(canonicalMediaValue(request)).digest("hex");
}

export function verifyMediaRequest(signed: SignedMediaRequest, secret: string): boolean {
  const expected = Buffer.from(signMediaRequest(signed.request, secret), "hex");
  const actual = Buffer.from(signed.signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function validateMediaModelPolicy(policy: MediaModelPolicy): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of policy.entries) {
    if (ids.has(entry.id)) errors.push(`duplicate model id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.versionOrCommit || /^(main|master|latest|head)$/i.test(entry.versionOrCommit)) errors.push(`model ${entry.id} must pin an exact version or commit`);
    if (!entry.provenanceSubjectId) errors.push(`model ${entry.id} is missing provenanceSubjectId`);
    if (!entry.outputTermsSubjectId) errors.push(`model ${entry.id} is missing outputTermsSubjectId`);
    if (!entry.serviceTermsSubjectId) errors.push(`model ${entry.id} is missing serviceTermsSubjectId`);
    if (entry.kind === "3d" && entry.adapter !== "mock" && entry.adapter !== "three-d-worker") errors.push(`3d model ${entry.id} must use the isolated three-d-worker boundary`);
    if (entry.kind === "image" && entry.adapter !== "mock" && entry.adapter !== "diffusers-image") errors.push(`image model ${entry.id} must use the diffusers-image boundary`);
    if (entry.kind === "video" && entry.adapter !== "mock" && entry.adapter !== "diffusers-video") errors.push(`video model ${entry.id} must use the diffusers-video boundary`);
  }
  if (!policy.productCoreForbiddenImports.some((value) => value.toLowerCase().includes("wangp"))) errors.push("WanGP must be explicitly forbidden from product-core imports");
  return errors;
}

export class DeterministicMockMediaWorker implements MediaWorker {
  adapter = "mock" as const;

  async generate(request: MediaRequest): Promise<MediaAsset> {
    const seed = sha256(canonicalMediaValue({ kind: request.kind, modelId: request.modelId, prompt: request.prompt, parameters: request.parameters }));
    if (request.kind === "image") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f8fafc"/><text x="32" y="64" font-family="system-ui" font-size="18" fill="#0f172a">deterministic-media:${seed.slice(0, 24)}</text></svg>`;
      return { mediaType: "image/svg+xml", extension: "svg", bytes: new TextEncoder().encode(svg) };
    }
    const payload = new TextEncoder().encode(JSON.stringify({ kind: request.kind, deterministicMock: true, seed }));
    return { mediaType: "application/json", extension: "json", bytes: payload };
  }
}

export async function routeMediaGeneration(args: {
  signed: SignedMediaRequest;
  secret: string;
  policy: MediaModelPolicy;
  workers: Partial<Record<MediaAdapter, MediaWorker>>;
  maxAttempts?: number;
  cancelled?: () => boolean;
}): Promise<{ receipt: MediaGenerationReceipt; asset?: MediaAsset }> {
  const { signed, secret, policy, workers } = args;
  const request = signed.request;
  const maxAttempts = Math.max(1, args.maxAttempts ?? 2);
  const base = {
    schema: "website-design-compiler/media-generation-receipt/v1" as const,
    gate: "DETERMINISTIC_MOCK" as const,
    productionReleaseEligible: false as const,
    requestId: request.requestId,
    requestSha256: sha256(canonicalMediaValue(request)),
    promptSha256: sha256(request.prompt),
    parameters: request.parameters,
    optimization: request.optimization,
    queue: { maxAttempts, attempts: 0, cancellation: "SUPPORTED" as const }
  };

  const policyErrors = validateMediaModelPolicy(policy);
  if (policyErrors.length > 0) {
    return { receipt: { ...base, overall: "FAIL", model: { id: request.modelId, kind: request.kind, adapter: "mock", admission: "DENY", versionOrCommit: "ABSENT", provenanceSubjectId: "ABSENT", outputTermsSubjectId: "ABSENT", serviceTermsSubjectId: "ABSENT" }, reason: `invalid media policy: ${policyErrors.join("; ")}` } };
  }
  if (!verifyMediaRequest(signed, secret)) {
    return { receipt: { ...base, overall: "FAIL", model: { id: request.modelId, kind: request.kind, adapter: "mock", admission: "DENY", versionOrCommit: "ABSENT", provenanceSubjectId: "ABSENT", outputTermsSubjectId: "ABSENT", serviceTermsSubjectId: "ABSENT" }, reason: "media request authentication failed" } };
  }

  const model = policy.entries.find((entry) => entry.id === request.modelId);
  if (!model || model.kind !== request.kind) {
    return { receipt: { ...base, overall: "FAIL", model: { id: request.modelId, kind: request.kind, adapter: "mock", admission: "DENY", versionOrCommit: "ABSENT", provenanceSubjectId: "ABSENT", outputTermsSubjectId: "ABSENT", serviceTermsSubjectId: "ABSENT" }, reason: "model is absent from the governed policy or kind does not match" } };
  }
  const modelReceipt = { id: model.id, kind: model.kind, adapter: model.adapter, admission: model.admission, versionOrCommit: model.versionOrCommit, provenanceSubjectId: model.provenanceSubjectId, outputTermsSubjectId: model.outputTermsSubjectId, serviceTermsSubjectId: model.serviceTermsSubjectId };
  if (model.admission !== "ALLOW") return { receipt: { ...base, overall: "FAIL", model: modelReceipt, reason: `model admission is ${model.admission}` } };
  if (model.adapter !== "mock") return { receipt: { ...base, overall: "FAIL", model: modelReceipt, reason: "production adapters must use the independent production provider route" } };

  const worker = workers[model.adapter];
  if (!worker || worker.adapter !== model.adapter) return { receipt: { ...base, overall: "FAIL", model: modelReceipt, reason: "required isolated media worker is unavailable" } };

  let lastReason = "worker failed";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (args.cancelled?.()) return { receipt: { ...base, overall: "FAIL", model: modelReceipt, queue: { ...base.queue, attempts: attempt - 1 }, reason: "generation cancelled before worker execution" } };
    try {
      const asset = await worker.generate(request);
      if (asset.bytes.byteLength > request.optimization.maxBytes) return { receipt: { ...base, overall: "FAIL", model: modelReceipt, queue: { ...base.queue, attempts: attempt }, reason: "generated asset exceeds optimization maxBytes" } };
      return {
        asset,
        receipt: {
          ...base,
          overall: "PASS",
          model: modelReceipt,
          queue: { ...base.queue, attempts: attempt },
          asset: { sha256: sha256(asset.bytes), bytes: asset.bytes.byteLength, mediaType: asset.mediaType, extension: asset.extension }
        }
      };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : "worker failed";
    }
  }
  return { receipt: { ...base, overall: "FAIL", model: modelReceipt, queue: { ...base.queue, attempts: maxAttempts }, reason: `worker unavailable after retries: ${lastReason}` } };
}
