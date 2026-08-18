import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUnconfiguredProductionProviderStatus,
  ProductionProviderError,
  routeProductionMediaGeneration,
  validateProductionProviderPolicy,
  type ProductionProviderPolicy,
  type ProductionProviderTransport
} from "../src/production-media-provider.js";
import { signMediaRequest, type MediaRequest } from "../src/media-router.js";
import type { RepositoryClearanceReceipt, RightsSubject } from "../src/repository-rights-clearance.js";

const request: MediaRequest = {
  schema: "website-design-compiler/media-request/v1",
  requestId: "production-request-1",
  kind: "image",
  modelId: "fixture-model",
  prompt: "A neutral geometric product scene",
  parameters: { width: 1024, height: 1024, seed: 42 },
  optimization: { target: "web", maxBytes: 65536 }
};

const secret = "ephemeral-production-test-secret";

const policy: ProductionProviderPolicy = {
  schema: "website-design-compiler/production-provider-policy/v1",
  identity: {
    providerId: "fixture-provider",
    serviceRevision: "date:2026-08-01",
    modelId: "fixture-model",
    modelRevision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    adapter: "diffusers-image",
    kind: "image"
  },
  rights: {
    modelWeight: { subjectId: "model:fixture-model", expectedIdentity: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    generatedOutput: { subjectId: "generated-output:fixture-model", expectedIdentity: "fixture-provider@date:2026-08-01/fixture-model@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    hostedService: { subjectId: "service:fixture-provider", expectedIdentity: "fixture-provider@date:2026-08-01" }
  },
  controls: {
    timeoutMs: 50,
    maxAttempts: 2,
    retryBackoffMs: 0,
    requestsPerWindow: 2,
    quotaUnitsPerRequest: 1
  },
  revocations: []
};

function subject(id: string, kind: RightsSubject["kind"], versionOrIdentity: string): RightsSubject {
  return {
    id,
    kind,
    name: id,
    versionOrIdentity,
    licenseExpression: "TEST_ONLY_RIGHTS_EVIDENCE",
    state: "ALLOW",
    evidence: ["test fixture"],
    attributionRequired: false,
    distributed: false,
    geographicRestrictions: [],
    usageRestrictions: []
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
  unresolved: [],
  expiredWaivers: [],
  noticeSubjects: [],
  legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE"
};

function signed() {
  return { request, signature: signMediaRequest(request, secret) };
}

const admittedExecution = {
  humanAdmission: "ADMITTED",
  credentials: "AVAILABLE",
  budget: "AUTHORIZED",
  admissionReceiptId: "human-admit:fixture:1",
  rateLimitRemaining: 2,
  quotaUnitsRemaining: 2
} as const;

test("production provider is not called without explicit human, credential, and budget admission", async () => {
  let calls = 0;
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      calls += 1;
      throw new Error("must not execute");
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(),
    secret,
    policy,
    rightsReceipt,
    transport
  });

  assert.equal(calls, 0);
  assert.equal(result.receipt.overall, "NOT_EXERCISED");
  assert.equal(result.receipt.admissionState, "NEEDS_HUMAN_ADMIT");
  assert.equal(result.receipt.productionReleaseEligible, false);
  assert.match(result.receipt.reason, /human admission|credentials|budget/i);
});

test("non-ALLOW repository rights fail closed before provider execution", async () => {
  let calls = 0;
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      calls += 1;
      throw new Error("must not execute");
    }
  };
  const reviewRequired: RepositoryClearanceReceipt = {
    ...rightsReceipt,
    overall: "FAIL",
    subjects: rightsReceipt.subjects.map((entry) => entry.id === policy.rights.generatedOutput.subjectId
      ? { ...entry, state: "REVIEW_REQUIRED" as const }
      : entry),
    counts: { ALLOW: 2, REVIEW_REQUIRED: 1, DENY: 0, UNKNOWN: 0, NOT_DISTRIBUTED: 0 },
    unresolved: [policy.rights.generatedOutput.subjectId]
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt: reviewRequired, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(calls, 0);
  assert.equal(result.receipt.overall, "NOT_EXERCISED");
  assert.equal(result.receipt.admissionState, "DENIED");
  assert.match(result.receipt.reason, /generated-output:fixture-model.*REVIEW_REQUIRED/);
});

test("production rights must explicitly record geographic and usage restriction fields", async () => {
  let calls = 0;
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      calls += 1;
      throw new Error("must not execute");
    }
  };
  const incompleteRights: RepositoryClearanceReceipt = {
    ...rightsReceipt,
    subjects: rightsReceipt.subjects.map((entry) => {
      if (entry.id !== policy.rights.modelWeight.subjectId) return entry;
      const { geographicRestrictions: _geographic, usageRestrictions: _usage, ...withoutRestrictions } = entry;
      return withoutRestrictions;
    })
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt: incompleteRights, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(calls, 0);
  assert.equal(result.receipt.overall, "NOT_EXERCISED");
  assert.equal(result.receipt.admissionState, "DENIED");
  assert.match(result.receipt.reason, /geographic.*usage.*ABSENT/);
});

test("rights identities must be derived from the exact provider and model revision", async () => {
  let calls = 0;
  const otherRevision = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const mismatchedPolicy: ProductionProviderPolicy = {
    ...policy,
    rights: {
      ...policy.rights,
      modelWeight: { ...policy.rights.modelWeight, expectedIdentity: otherRevision }
    }
  };
  const mismatchedRights: RepositoryClearanceReceipt = {
    ...rightsReceipt,
    subjects: rightsReceipt.subjects.map((entry) => entry.id === policy.rights.modelWeight.subjectId
      ? { ...entry, versionOrIdentity: otherRevision }
      : entry)
  };
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      calls += 1;
      throw new Error("must not execute");
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy: mismatchedPolicy, rightsReceipt: mismatchedRights, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(calls, 0);
  assert.equal(result.receipt.overall, "FAIL");
  assert.match(result.receipt.reason, /modelWeight.*exact model revision/);
});

test("data-driven revocation blocks the exact provider model revision before execution", async () => {
  let calls = 0;
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      calls += 1;
      throw new Error("must not execute");
    }
  };
  const revoked: ProductionProviderPolicy = {
    ...policy,
    revocations: [{
      providerId: policy.identity.providerId,
      modelId: policy.identity.modelId,
      modelRevision: policy.identity.modelRevision,
      reason: "fixture emergency revocation",
      effectiveAt: "2026-08-18T00:00:00.000Z"
    }]
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy: revoked, rightsReceipt, transport,
    executionAdmission: admittedExecution,
    now: new Date("2026-08-18T00:00:01.000Z")
  });

  assert.equal(calls, 0);
  assert.equal(result.receipt.overall, "NOT_EXERCISED");
  assert.equal(result.receipt.admissionState, "REVOKED");
  assert.equal(result.receipt.reason, "provider identity revoked by policy");
  assert.match(result.receipt.revocation?.reasonSha256 ?? "", /^[a-f0-9]{64}$/);
});

test("successful real-provider receipt binds exact identity and complete artifact provenance", async () => {
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate({ request: received, attempt }) {
      assert.equal(received.requestId, request.requestId);
      assert.equal(attempt, 1);
      return {
        asset: {
          mediaType: "image/webp",
          extension: "webp",
          bytes: new TextEncoder().encode("production-fixture")
        },
        providerRequestId: "provider-job-fixture-1",
        seed: 42,
        postProcessing: [{ operation: "webp-encode", revision: "version:1.0.0" }]
      };
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(result.receipt.overall, "PASS");
  assert.equal(result.receipt.admissionState, "ADMITTED");
  assert.equal(result.receipt.productionReleaseEligible, true);
  assert.equal(result.receipt.attempts, 1);
  assert.equal(result.receipt.admissionEvidence.humanAdmissionReceiptId, "human-admit:fixture:1");
  assert.deepEqual(result.receipt.admissionEvidence.rightsSubjectIds, [
    "model:fixture-model",
    "generated-output:fixture-model",
    "service:fixture-provider"
  ]);
  assert.deepEqual(result.receipt.provider, policy.identity);
  assert.equal(result.receipt.asset?.sha256, "06f4ac560ea7f02b07e7a162b13bc5978aa831a6d42c8cc6db205369ce96804c");
  assert.equal(result.receipt.provenance?.providerRequestId, "provider-job-fixture-1");
  assert.equal(result.receipt.provenance?.seed, 42);
  assert.equal(result.receipt.provenance?.promptConfigurationSha256, result.receipt.configurationSha256);
  assert.deepEqual(result.receipt.provenance?.postProcessing, [
    { operation: "webp-encode", revision: "version:1.0.0" }
  ]);
  assert.ok(result.asset);
});

test("transient provider outage retries within the policy bound and records the actual attempt", async () => {
  let calls = 0;
  const slept: number[] = [];
  const retryPolicy: ProductionProviderPolicy = {
    ...policy,
    controls: { ...policy.controls, retryBackoffMs: 7 }
  };
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate({ attempt }) {
      calls += 1;
      if (attempt === 1) throw new ProductionProviderError("OUTAGE", "fixture provider unavailable");
      return {
        asset: { mediaType: "image/webp", extension: "webp", bytes: new TextEncoder().encode("production-fixture") },
        providerRequestId: "provider-job-fixture-retry",
        seed: 42,
        postProcessing: []
      };
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy: retryPolicy, rightsReceipt, transport,
    executionAdmission: admittedExecution,
    sleep: async (milliseconds) => { slept.push(milliseconds); }
  });

  assert.equal(calls, 2);
  assert.deepEqual(slept, [7]);
  assert.equal(result.receipt.overall, "PASS");
  assert.equal(result.receipt.attempts, 2);
});

test("cancellation prevents provider execution and remains NOT_EXERCISED", async () => {
  let calls = 0;
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      calls += 1;
      throw new Error("must not execute");
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: admittedExecution,
    cancelled: () => true
  });

  assert.equal(calls, 0);
  assert.equal(result.receipt.overall, "NOT_EXERCISED");
  assert.equal(result.receipt.attempts, 0);
  assert.match(result.receipt.reason, /cancelled/);
});

test("provider timeout aborts each bounded attempt and fails deterministically", async () => {
  let calls = 0;
  let aborts = 0;
  const timeoutPolicy: ProductionProviderPolicy = {
    ...policy,
    controls: { ...policy.controls, timeoutMs: 5, retryBackoffMs: 0, maxAttempts: 2 }
  };
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    generate({ signal }) {
      calls += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({
          asset: { mediaType: "image/webp", extension: "webp", bytes: new TextEncoder().encode("late") },
          providerRequestId: "late-provider-job",
          seed: 42,
          postProcessing: []
        }), 20);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          aborts += 1;
          reject(new ProductionProviderError("CANCELLED", "transport observed abort"));
        }, { once: true });
      });
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy: timeoutPolicy, rightsReceipt, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(calls, 2);
  assert.equal(aborts, 2);
  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.attempts, 2);
  assert.match(result.receipt.reason, /timed out after 5ms/);
});

test("production policy rejects floating identities, incomplete rights bindings, and invalid controls", () => {
  const invalid: ProductionProviderPolicy = {
    ...policy,
    identity: { ...policy.identity, serviceRevision: "stable", modelRevision: "current" },
    rights: {
      ...policy.rights,
      modelWeight: { subjectId: "", expectedIdentity: "" }
    },
    controls: { ...policy.controls, timeoutMs: 0, maxAttempts: 0 },
    revocations: [{
      providerId: policy.identity.providerId,
      modelId: policy.identity.modelId,
      modelRevision: policy.identity.modelRevision,
      reason: "",
      effectiveAt: "2026-08-18"
    }]
  };

  const errors = validateProductionProviderPolicy(invalid).join("\n");
  assert.match(errors, /serviceRevision.*exact/);
  assert.match(errors, /modelRevision.*exact/);
  assert.match(errors, /modelWeight.*subjectId/);
  assert.match(errors, /modelWeight.*expectedIdentity/);
  assert.match(errors, /timeoutMs/);
  assert.match(errors, /maxAttempts/);
  assert.match(errors, /revocation.*reason/);
  assert.match(errors, /revocation.*effectiveAt/);
});

test("rate-limit and quota exhaustion are deterministic preflight stops", async () => {
  let calls = 0;
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      calls += 1;
      throw new Error("must not execute");
    }
  };

  const rateLimited = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: { ...admittedExecution, rateLimitRemaining: 0 }
  });
  const quotaExhausted = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: { ...admittedExecution, quotaUnitsRemaining: 0 }
  });

  assert.equal(calls, 0);
  assert.equal(rateLimited.receipt.overall, "NOT_EXERCISED");
  assert.match(rateLimited.receipt.reason, /rate limit/);
  assert.equal(quotaExhausted.receipt.overall, "NOT_EXERCISED");
  assert.match(quotaExhausted.receipt.reason, /quota/);
});

test("unconfigured production status cannot inherit deterministic mock PASS", () => {
  const status = buildUnconfiguredProductionProviderStatus();

  assert.equal(status.gate, "PRODUCTION_PROVIDER");
  assert.equal(status.overall, "NOT_EXERCISED");
  assert.equal(status.admissionState, "NEEDS_HUMAN_ADMIT");
  assert.equal(status.productionReleaseEligible, false);
  assert.equal(status.providerIdentity, "ABSENT");
  assert.match(status.reason, /credentials.*budget.*rights.*human admission/i);
});

test("provider response cannot claim a seed different from the requested configuration", async () => {
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      return {
        asset: { mediaType: "image/webp", extension: "webp", bytes: new TextEncoder().encode("wrong-seed") },
        providerRequestId: "provider-job-wrong-seed",
        seed: 43,
        postProcessing: []
      };
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.productionReleaseEligible, false);
  assert.match(result.receipt.reason, /seed.*does not match/);
});

test("retries cannot exceed admitted rate-limit or quota capacity", async () => {
  let calls = 0;
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      calls += 1;
      throw new ProductionProviderError("OUTAGE", "fixture outage");
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: {
      ...admittedExecution,
      rateLimitRemaining: 1,
      quotaUnitsRemaining: 1
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.attempts, 1);
  assert.match(result.receipt.reason, /retry blocked.*rate-limit.*quota/i);
});

test("external cancellation aborts an in-flight provider call", async () => {
  const cancellation = new AbortController();
  let aborts = 0;
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    generate({ signal }) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({
          asset: { mediaType: "image/webp", extension: "webp", bytes: new TextEncoder().encode("late-cancel") },
          providerRequestId: "late-cancel-job",
          seed: 42,
          postProcessing: []
        }), 20);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          aborts += 1;
          reject(new ProductionProviderError("CANCELLED", "transport cancelled"));
        }, { once: true });
        queueMicrotask(() => cancellation.abort());
      });
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: admittedExecution,
    signal: cancellation.signal
  });

  assert.equal(aborts, 1);
  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.attempts, 1);
  assert.match(result.receipt.reason, /cancelled/);
});

test("provider errors cannot leak tokens, URLs, or machine-private paths into receipts", async () => {
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      throw new Error("https://provider.invalid/job?token=do-not-publish /Users/operator/private.json");
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.reason, "production provider failed");
  assert.doesNotMatch(JSON.stringify(result.receipt), /do-not-publish|provider\.invalid|\/Users\/operator/);
});

test("empty or malformed provider assets cannot become production-release eligible", async () => {
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      return {
        asset: { mediaType: "", extension: "../webp", bytes: new Uint8Array() },
        providerRequestId: "provider-job-empty-asset",
        seed: 42,
        postProcessing: []
      };
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.productionReleaseEligible, false);
  assert.match(result.receipt.reason, /empty|mediaType|extension/);
});

test("provider asset media type must match the requested media kind", async () => {
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      return {
        asset: { mediaType: "text/plain", extension: "txt", bytes: new TextEncoder().encode("not-an-image") },
        providerRequestId: "provider-job-wrong-media-kind",
        seed: 42,
        postProcessing: []
      };
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.productionReleaseEligible, false);
  assert.match(result.receipt.reason, /mediaType.*image/);
});

test("successful provider metadata cannot smuggle tokens or machine paths into receipts", async () => {
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      return {
        asset: { mediaType: "image/webp", extension: "webp", bytes: new TextEncoder().encode("unsafe-metadata") },
        providerRequestId: "https://provider.invalid/job?token=do-not-publish",
        seed: 42,
        postProcessing: [{ operation: "webp-encode", revision: "/Users/operator/private-tool" }]
      };
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.productionReleaseEligible, false);
  assert.doesNotMatch(JSON.stringify(result.receipt), /do-not-publish|provider\.invalid|\/Users\/operator/);
});

test("provider asset MIME and extension must describe the same format", async () => {
  const transport: ProductionProviderTransport = {
    identity: policy.identity,
    async generate() {
      return {
        asset: { mediaType: "image/png", extension: "exe", bytes: new Uint8Array([1, 2, 3]) },
        providerRequestId: "provider-job-mismatched-extension",
        seed: 42,
        postProcessing: []
      };
    }
  };

  const result = await routeProductionMediaGeneration({
    signed: signed(), secret, policy, rightsReceipt, transport,
    executionAdmission: admittedExecution
  });

  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.productionReleaseEligible, false);
  assert.match(result.receipt.reason, /mediaType.*extension|format/);
});
