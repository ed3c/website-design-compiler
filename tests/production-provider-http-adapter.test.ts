import assert from "node:assert/strict";
import test from "node:test";
import {
  createHttpProductionProviderTransport,
  validateHttpProductionProviderAdapterConfig,
  type HttpProductionProviderAdapterConfig
} from "../src/production-provider-http-adapter.js";
import { ProductionProviderError } from "../src/production-media-provider.js";

const identity = {
  providerId: "fixture-provider",
  serviceRevision: "date:2026-08-01",
  modelId: "fixture-model",
  modelRevision: `sha256:${"a".repeat(64)}`,
  adapter: "diffusers-image",
  kind: "image"
} as const;
const config: HttpProductionProviderAdapterConfig = {
  schema: "website-design-compiler/http-production-provider-adapter/v1",
  identity,
  endpoint: "https://provider.invalid/v1/generate"
};
const request = {
  schema: "website-design-compiler/media-request/v1",
  requestId: "request-1",
  kind: "image",
  modelId: "fixture-model",
  prompt: "fixture",
  parameters: { width: 16, height: 12, seed: 42 },
  optimization: { target: "web", maxBytes: 65_536 }
} as const;
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGOsCDjBQApgIkn1qIYRpAEAsVkBqEXr8uYAAAAASUVORK5CYII=";

test("HTTP adapter rejects insecure or credential-bearing endpoints", () => {
  assert.deepEqual(validateHttpProductionProviderAdapterConfig(config), []);
  assert.match(validateHttpProductionProviderAdapterConfig({ ...config, endpoint: "http://provider.invalid/v1" }).join("; "), /HTTPS/);
  assert.match(validateHttpProductionProviderAdapterConfig({ ...config, endpoint: "https://token@provider.invalid/v1?q=secret" }).join("; "), /credentials.*query/);
  assert.match(validateHttpProductionProviderAdapterConfig({ ...config, endpoint: "https://localhost/v1" }).join("; "), /non-local/);
});

test("HTTP adapter sends credentials only in the request header and parses a strict bounded response", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const transport = createHttpProductionProviderTransport({
    config,
    credential: "fixture-secret",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        schema: "website-design-compiler/http-production-provider-response/v1",
        providerRequestId: "provider-job-1",
        seed: 42,
        postProcessing: [{ operation: "png-encode", revision: "version:1.0.0" }],
        asset: { mediaType: "image/png", extension: "png", bytesBase64: pngBase64 }
      }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }
  });

  const result = await transport.generate({ request, signal: new AbortController().signal, attempt: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, config.endpoint);
  assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), "Bearer fixture-secret");
  assert.doesNotMatch(String(calls[0]?.init?.body), /fixture-secret/);
  assert.equal(result.asset.bytes.byteLength, 80);
  assert.equal(result.providerRequestId, "provider-job-1");
});

test("HTTP adapter rejects extra response fields and never returns provider error bodies", async () => {
  const transport = createHttpProductionProviderTransport({
    config,
    credential: "fixture-secret",
    fetchImpl: async () => new Response(JSON.stringify({
      schema: "website-design-compiler/http-production-provider-response/v1",
      providerRequestId: "provider-job-1",
      seed: 42,
      postProcessing: [],
      asset: { mediaType: "image/png", extension: "png", bytesBase64: pngBase64 },
      token: "do-not-publish"
    }), { status: 200, headers: { "content-type": "application/json" } })
  });
  await assert.rejects(
    transport.generate({ request, signal: new AbortController().signal, attempt: 1 }),
    (error: unknown) => error instanceof ProductionProviderError && error.code === "INVALID_RESPONSE" && !error.message.includes("do-not-publish")
  );
});
