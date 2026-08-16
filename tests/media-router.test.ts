import assert from "node:assert/strict";
import test from "node:test";
import {
  DeterministicMockMediaWorker,
  routeMediaGeneration,
  signMediaRequest,
  validateMediaModelPolicy,
  type MediaModelPolicy,
  type MediaRequest,
  type MediaWorker
} from "../src/media-router.js";

const policy: MediaModelPolicy = {
  schema: "website-design-compiler/media-model-policy/v1",
  productCoreForbiddenImports: ["WanGP"],
  entries: [
    {
      id: "mock-image-v1",
      kind: "image",
      adapter: "mock",
      admission: "ALLOW",
      versionOrCommit: "internal:mock-image-v1",
      provenanceSubjectId: "model:mock-image-v1",
      outputTermsSubjectId: "generated-output:mock-image-v1"
    },
    {
      id: "review-image",
      kind: "image",
      adapter: "diffusers-image",
      admission: "REVIEW_REQUIRED",
      versionOrCommit: "adapter-contract:v1",
      provenanceSubjectId: "model:review-image",
      outputTermsSubjectId: "generated-output:review-image"
    }
  ]
};

const request: MediaRequest = {
  schema: "website-design-compiler/media-request/v1",
  requestId: "req-1",
  kind: "image",
  modelId: "mock-image-v1",
  prompt: "neutral abstract evidence diagram",
  parameters: { seed: 1 },
  optimization: { target: "web", maxBytes: 65536 }
};

const secret = "ephemeral-test-secret";

function signed(value = request) {
  return { request: value, signature: signMediaRequest(value, secret) };
}

test("deterministic mock worker emits reproducible hashed asset receipt", async () => {
  const worker = new DeterministicMockMediaWorker();
  const first = await routeMediaGeneration({ signed: signed(), secret, policy, workers: { mock: worker } });
  const second = await routeMediaGeneration({ signed: signed(), secret, policy, workers: { mock: worker } });
  assert.equal(first.receipt.overall, "PASS");
  assert.equal(first.receipt.asset?.sha256, second.receipt.asset?.sha256);
  assert.equal(first.receipt.model.versionOrCommit, "internal:mock-image-v1");
  assert.deepEqual(first.receipt.parameters, { seed: 1 });
});

test("invalid authentication fails before worker execution", async () => {
  const result = await routeMediaGeneration({ signed: { request, signature: "00" }, secret, policy, workers: { mock: new DeterministicMockMediaWorker() } });
  assert.equal(result.receipt.overall, "FAIL");
  assert.match(result.receipt.reason ?? "", /authentication failed/);
});

test("review-required or unknown model cannot execute", async () => {
  const review = { ...request, modelId: "review-image" };
  const reviewResult = await routeMediaGeneration({ signed: signed(review), secret, policy, workers: { mock: new DeterministicMockMediaWorker() } });
  assert.equal(reviewResult.receipt.overall, "FAIL");
  assert.match(reviewResult.receipt.reason ?? "", /REVIEW_REQUIRED/);

  const unknown = { ...request, modelId: "unknown-model" };
  const unknownResult = await routeMediaGeneration({ signed: signed(unknown), secret, policy, workers: { mock: new DeterministicMockMediaWorker() } });
  assert.equal(unknownResult.receipt.overall, "FAIL");
});

test("worker outage retries then fails without affecting page runtime ownership", async () => {
  let calls = 0;
  const failingWorker: MediaWorker = {
    adapter: "mock",
    async generate() {
      calls += 1;
      throw new Error("worker offline");
    }
  };
  const result = await routeMediaGeneration({ signed: signed(), secret, policy, workers: { mock: failingWorker }, maxAttempts: 2 });
  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(result.receipt.queue.attempts, 2);
  assert.equal(calls, 2);
  assert.match(result.receipt.reason ?? "", /worker unavailable/);
});

test("cancellation stops execution before worker call", async () => {
  let called = false;
  const worker: MediaWorker = {
    adapter: "mock",
    async generate(value) {
      called = true;
      return new DeterministicMockMediaWorker().generate(value);
    }
  };
  const result = await routeMediaGeneration({ signed: signed(), secret, policy, workers: { mock: worker }, cancelled: () => true });
  assert.equal(result.receipt.overall, "FAIL");
  assert.equal(called, false);
  assert.match(result.receipt.reason ?? "", /cancelled/);
});

test("policy rejects floating versions, missing rights references, wrong adapter boundaries, and missing WanGP deny rule", () => {
  const broken: MediaModelPolicy = {
    schema: "website-design-compiler/media-model-policy/v1",
    productCoreForbiddenImports: [],
    entries: [{
      id: "bad-3d",
      kind: "3d",
      adapter: "diffusers-image",
      admission: "ALLOW",
      versionOrCommit: "latest",
      provenanceSubjectId: "",
      outputTermsSubjectId: ""
    }]
  };
  const errors = validateMediaModelPolicy(broken).join("\n");
  assert.match(errors, /exact version or commit/);
  assert.match(errors, /provenanceSubjectId/);
  assert.match(errors, /outputTermsSubjectId/);
  assert.match(errors, /three-d-worker/);
  assert.match(errors, /WanGP/);
});

test("asset optimization budget fails closed", async () => {
  const tinyBudget = { ...request, optimization: { target: "web" as const, maxBytes: 1 } };
  const result = await routeMediaGeneration({ signed: signed(tinyBudget), secret, policy, workers: { mock: new DeterministicMockMediaWorker() } });
  assert.equal(result.receipt.overall, "FAIL");
  assert.match(result.receipt.reason ?? "", /exceeds optimization/);
});
