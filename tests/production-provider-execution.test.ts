import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { canonicalMediaValue, sha256, signMediaRequest, type MediaRequest } from "../src/media-router.js";
import { productionAdmissionSigningPayload, type ProductionAdmissionPacket } from "../src/production-provider-admission.js";
import {
  executeProductionProviderConfiguration,
  validateProductionProviderExecutionConfig,
  type ProductionProviderExecutionConfig
} from "../src/production-provider-execution.js";
import type { ProductionProviderPolicy } from "../src/production-media-provider.js";
import type { RepositoryClearanceReceipt, RightsSubject } from "../src/repository-rights-clearance.js";
import { validateAgainstSchema } from "../src/validate.js";

const secret = "fixture-request-secret";
const request: MediaRequest = {
  schema: "website-design-compiler/media-request/v1",
  requestId: "configured-request-1",
  kind: "image",
  modelId: "fixture-model",
  prompt: "A neutral geometric product scene",
  parameters: { width: 16, height: 12, seed: 42 },
  optimization: { target: "web", maxBytes: 65_536 }
};
const policy: ProductionProviderPolicy = {
  schema: "website-design-compiler/production-provider-policy/v1",
  identity: {
    providerId: "fixture-provider",
    serviceRevision: "date:2026-08-01",
    modelId: "fixture-model",
    modelRevision: `sha256:${"a".repeat(64)}`,
    adapter: "diffusers-image",
    kind: "image"
  },
  rights: {
    modelWeight: { subjectId: "model:fixture-model", expectedIdentity: `sha256:${"a".repeat(64)}` },
    generatedOutput: { subjectId: "generated-output:fixture-model", expectedIdentity: `fixture-provider@date:2026-08-01/fixture-model@sha256:${"a".repeat(64)}` },
    hostedService: { subjectId: "service:fixture-provider", expectedIdentity: "fixture-provider@date:2026-08-01" }
  },
  controls: { timeoutMs: 100, maxAttempts: 1, retryBackoffMs: 0, requestsPerWindow: 1, quotaUnitsPerRequest: 1 },
  revocations: []
};
function subject(id: string, kind: RightsSubject["kind"], identity: string): RightsSubject {
  return {
    id, kind, name: id, versionOrIdentity: identity, licenseExpression: "TEST_ONLY_RIGHTS_EVIDENCE",
    state: "ALLOW", evidence: ["test fixture"], attributionRequired: false, distributed: false,
    geographicRestrictions: [], usageRestrictions: []
  };
}
const rightsReceipt: RepositoryClearanceReceipt = {
  schema: "website-design-compiler/repository-rights-clearance/v2",
  overall: "PASS",
  generatedAt: "2026-08-18T00:00:00.000Z",
  subjects: [
    subject(policy.rights.modelWeight.subjectId, "model", policy.rights.modelWeight.expectedIdentity),
    subject(policy.rights.generatedOutput.subjectId, "generated-output", policy.rights.generatedOutput.expectedIdentity),
    subject(policy.rights.hostedService.subjectId, "service", policy.rights.hostedService.expectedIdentity)
  ],
  counts: { ALLOW: 3, REVIEW_REQUIRED: 0, DENY: 0, UNKNOWN: 0, NOT_DISTRIBUTED: 0 },
  unresolved: [], expiredWaivers: [], noticeSubjects: [],
  legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE"
};
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const authorityKeySha256 = sha256(publicKey.export({ type: "spki", format: "der" }));
const config: ProductionProviderExecutionConfig = {
  schema: "website-design-compiler/production-provider-execution-config/v1",
  signedRequestPath: "signed-request.json",
  policyPath: "policy.json",
  rightsReceiptPath: "rights.json",
  admissionPacketPath: "admission.json",
  admissionAuthority: { authorityId: "fixture-reviewer", publicKeyPath: "reviewer.pub.pem" },
  adapter: {
    schema: "website-design-compiler/http-production-provider-adapter/v1",
    identity: policy.identity,
    endpoint: "https://provider.invalid/v1/generate"
  },
  requestSecretEnv: "WDC_FIXTURE_REQUEST_SECRET",
  credentialEnv: "WDC_FIXTURE_PROVIDER_CREDENTIAL"
};

function admission(): ProductionAdmissionPacket {
  const packet: ProductionAdmissionPacket = {
    schema: "website-design-compiler/production-provider-admission/v1",
    state: "ADMITTED",
    admissionId: "human-admit:configured:1",
    approvedBy: "fixture-reviewer",
    issuedAt: "2026-08-18T00:00:00.000Z",
    expiresAt: "2026-08-19T00:00:00.000Z",
    requestSha256: sha256(canonicalMediaValue(request)),
    providerIdentitySha256: sha256(canonicalMediaValue(policy.identity)),
    transportSha256: sha256(canonicalMediaValue(config.adapter)),
    modelIdentitySha256: sha256(canonicalMediaValue({ modelId: policy.identity.modelId, modelRevision: policy.identity.modelRevision, kind: policy.identity.kind })),
    policySha256: sha256(canonicalMediaValue(policy)),
    rightsReceiptSha256: sha256(canonicalMediaValue(rightsReceipt)),
    credentials: "AVAILABLE",
    budget: "AUTHORIZED",
    rateLimitRemaining: 1,
    quotaUnitsRemaining: 1,
    authorityKeySha256,
    signatureAlgorithm: "Ed25519",
    signatureBase64: "PENDING"
  };
  packet.signatureBase64 = sign(null, Buffer.from(productionAdmissionSigningPayload(packet)), privateKey).toString("base64");
  return packet;
}

test("configured status path composes signed admission, HTTP adapter, asset validation, and release-safe status", async () => {
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGOsCDjBQApgIkn1qIYRpAEAsVkBqEXr8uYAAAAASUVORK5CYII=";
  const result = await executeProductionProviderConfiguration({
    config,
    signed: { request, signature: signMediaRequest(request, secret) },
    policy,
    rightsReceipt,
    admissionPacket: admission(),
    admissionPublicKeyPem: publicKeyPem,
    requestSecret: secret,
    providerCredential: "fixture-provider-token",
    now: new Date("2026-08-18T12:00:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({
      schema: "website-design-compiler/http-production-provider-response/v1",
      providerRequestId: "provider-job-configured-1",
      seed: 42,
      postProcessing: [{ operation: "png-encode", revision: "version:1.0.0" }],
      asset: { mediaType: "image/png", extension: "png", bytesBase64: pngBase64 }
    }), { status: 200, headers: { "content-type": "application/json" } })
  });

  assert.equal(result.receipt.schema, "website-design-compiler/production-provider-receipt/v2");
  assert.equal(result.receipt.overall, "PASS");
  assert.equal(result.status.overall, "PASS");
  assert.equal(result.status.productionReleaseEligible, true);
  assert.match(result.status.providerIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.status.executionReceiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.status.assetSha256, result.receipt.asset?.sha256);
  assert.doesNotMatch(JSON.stringify(result.status), /fixture-provider-token|fixture-request-secret/);
  await validateAgainstSchema({ ...result.status, git: { sha: "a".repeat(40), ref: "refs/heads/test" } }, "production-provider-status.schema.json");
});

test("execution config rejects traversal, common environment variables, and secret reuse", () => {
  const errors = validateProductionProviderExecutionConfig({
    ...config,
    signedRequestPath: "../outside.json",
    requestSecretEnv: "HOME",
    credentialEnv: "HOME"
  }).join("; ");
  assert.match(errors, /signedRequestPath.*safe relative/);
  assert.match(errors, /requestSecretEnv.*dedicated/);
  assert.match(errors, /credentialEnv.*dedicated/);
  assert.match(errors, /separate environment/);
});
