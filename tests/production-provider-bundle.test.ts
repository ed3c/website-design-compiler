import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  materializeProductionProviderBundle,
  type ProductionProviderExecutionBundle
} from "../src/production-provider-bundle.js";

const { publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const authorityKeySha256 = createHash("sha256")
  .update(publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");

const identity = {
  providerId: "fixture-provider",
  serviceRevision: "date:2026-08-19",
  modelId: "fixture-model",
  modelRevision: `sha256:${"a".repeat(64)}`,
  adapter: "diffusers-image" as const,
  kind: "image" as const
};

const bundle: ProductionProviderExecutionBundle = {
  schema: "website-design-compiler/production-provider-execution-bundle/v1",
  config: {
    schema: "website-design-compiler/production-provider-execution-config/v1",
    signedRequestPath: "signed-request.json",
    policyPath: "policy.json",
    admissionPacketPath: "admission.json",
    admissionAuthority: {
      authorityId: "release-controller",
      publicKeyPath: "admission-public-key.pem"
    },
    adapter: {
      schema: "website-design-compiler/http-production-provider-adapter/v1",
      identity,
      endpoint: "https://provider.invalid/v1/generate"
    },
    requestSecretEnv: "WDC_PRODUCTION_REQUEST_SECRET",
    credentialEnv: "WDC_PRODUCTION_PROVIDER_CREDENTIAL"
  },
  signedRequest: {
    request: {
      schema: "website-design-compiler/media-request/v1",
      requestId: "release-image-1",
      kind: "image",
      modelId: "fixture-model",
      prompt: "A governed product image",
      parameters: { width: 1200, height: 800, seed: 42 },
      optimization: { target: "web", maxBytes: 1_000_000 }
    },
    signature: "b".repeat(64)
  },
  policy: {
    schema: "website-design-compiler/production-provider-policy/v1",
    identity,
    rights: {
      modelWeight: { subjectId: "model:fixture-model", expectedIdentity: identity.modelRevision },
      generatedOutput: {
        subjectId: "generated-output:fixture-model",
        expectedIdentity: `${identity.providerId}@${identity.serviceRevision}/${identity.modelId}@${identity.modelRevision}`
      },
      hostedService: {
        subjectId: "service:fixture-provider",
        expectedIdentity: `${identity.providerId}@${identity.serviceRevision}`
      }
    },
    controls: {
      timeoutMs: 30_000,
      maxAttempts: 2,
      retryBackoffMs: 250,
      requestsPerWindow: 1,
      quotaUnitsPerRequest: 1
    },
    revocations: []
  },
  admissionPacket: {
    schema: "website-design-compiler/production-provider-admission/v1",
    state: "ADMITTED",
    admissionId: "release-admit-1",
    approvedBy: "release-controller",
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: "2026-08-20T00:00:00.000Z",
    requestSha256: "c".repeat(64),
    providerIdentitySha256: "d".repeat(64),
    transportSha256: "e".repeat(64),
    modelIdentitySha256: "f".repeat(64),
    policySha256: "1".repeat(64),
    rightsReceiptSha256: "2".repeat(64),
    credentials: "AVAILABLE",
    budget: "AUTHORIZED",
    rateLimitRemaining: 1,
    quotaUnitsRemaining: 1,
    authorityKeySha256,
    signatureAlgorithm: "Ed25519",
    signatureBase64: Buffer.alloc(64, 3).toString("base64")
  },
  admissionPublicKeyPem: publicKeyPem
};

function encode(value: unknown): { base64: string; sha256: string } {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  return {
    base64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

test("absent protected provider inputs remain explicitly NOT_EXERCISED", async () => {
  assert.deepEqual(await materializeProductionProviderBundle({}), {
    state: "NOT_EXERCISED",
    configPath: ""
  });
  await assert.rejects(
    materializeProductionProviderBundle({ encodedBundle: encode(bundle).base64 }),
    /must be provided together/
  );
});

test("a hash-bound protected bundle materializes only fixed non-secret inputs", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "wdc-provider-bundle-test-"));
  try {
    const encoded = encode(bundle);
    const result = await materializeProductionProviderBundle({
      encodedBundle: encoded.base64,
      expectedSha256: encoded.sha256,
      temporaryRoot
    });
    assert.equal(result.state, "MATERIALIZED");
    assert.equal(result.bundleSha256, encoded.sha256);
    assert.equal(await readFile(result.configPath, "utf8"), `${JSON.stringify(bundle.config, null, 2)}\n`);
    assert.deepEqual(
      JSON.parse(await readFile(join(dirname(result.configPath), "signed-request.json"), "utf8")),
      bundle.signedRequest
    );
    assert.equal(await readFile(join(dirname(result.configPath), "admission-public-key.pem"), "utf8"), publicKeyPem);

    const materialized = ["config.json", "signed-request.json", "policy.json", "admission.json", "admission-public-key.pem"]
      .map((name) => readFile(join(dirname(result.configPath), name), "utf8"));
    assert.doesNotMatch((await Promise.all(materialized)).join("\n"), /fixture-request-secret|fixture-provider-token|must-not-be-materialized/);
    assert.equal(bundle.config.requestSecretEnv, "WDC_PRODUCTION_REQUEST_SECRET");
    assert.equal(bundle.config.credentialEnv, "WDC_PRODUCTION_PROVIDER_CREDENTIAL");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("bundle materialization rejects drift, malformed bytes, path/env changes, and embedded secrets", async () => {
  const encoded = encode(bundle);
  await assert.rejects(
    materializeProductionProviderBundle({ encodedBundle: encoded.base64, expectedSha256: "0".repeat(64) }),
    /does not match the externally trusted SHA-256/
  );
  await assert.rejects(
    materializeProductionProviderBundle({ encodedBundle: "not-base64", expectedSha256: encoded.sha256 }),
    /canonical base64/
  );

  const changedConfig = structuredClone(bundle);
  changedConfig.config.signedRequestPath = "alternate-request.json";
  const changedConfigEncoded = encode(changedConfig);
  await assert.rejects(
    materializeProductionProviderBundle({
      encodedBundle: changedConfigEncoded.base64,
      expectedSha256: changedConfigEncoded.sha256
    }),
    /signedRequestPath must be signed-request.json/
  );

  const embeddedSecret = { ...bundle, providerCredential: "must-not-be-materialized" };
  const embeddedSecretEncoded = encode(embeddedSecret);
  await assert.rejects(
    materializeProductionProviderBundle({
      encodedBundle: embeddedSecretEncoded.base64,
      expectedSha256: embeddedSecretEncoded.sha256
    }),
    /forbidden secret field|additional properties/
  );
});
