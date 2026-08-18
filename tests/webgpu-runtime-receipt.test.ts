import assert from "node:assert/strict";
import test from "node:test";
import { buildWebGPUAdapterInfoEvidence } from "../src/webgpu-runtime-identity.js";
import { validateAgainstSchema } from "../src/validate.js";

async function trueWebGPUReceipt() {
  const adapterInfo = await buildWebGPUAdapterInfoEvidence({
    vendor: "private-vendor",
    architecture: "private-architecture",
    device: "private-device",
    description: "private-description"
  });
  return {
    schema: "website-design-compiler/webgpu-runtime-receipt/v1",
    overall: "PASS",
    rendererOutcome: "WEBGPU_PASS",
    git: { sha: "a".repeat(40), ref: "refs/heads/test" },
    selected: {
      state: "WEBGPU_PASS",
      renderer: "webgpu",
      reason: "webgpu-runtime-observed",
      capabilities: { webgpu: true, webgl: true },
      runtime: {
        state: "WEBGPU_PASS",
        identity: {
          adapter: "navigator.gpu",
          renderer: "three.WebGPURenderer",
          rendererVersion: "0.184.0",
          tslModule: "three/tsl@0.184.0",
          adapterInfo,
          features: ["texture-compression-bc"],
          limits: { maxTextureDimension2D: 8192, maxBindGroups: 4, maxBufferSize: 268435456 }
        },
        budget: { dpr: 1.5, drawCalls: 1, triangles: 12, textureBytes: 0, framesRendered: 1, frameLoop: "demand" }
      }
    },
    fallbacks: { initializationFailure: "PASS", totalGpuFailure: "PASS", deviceLoss: "PASS" }
  };
}

test("true-WebGPU-shaped receipt validates with a privacy-preserving exact adapter fingerprint", async () => {
  const receipt = await trueWebGPUReceipt();
  await validateAgainstSchema(receipt, "webgpu-runtime-receipt.schema.json");
  assert.match(receipt.selected.runtime.identity.adapterInfo.sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(receipt), /private-vendor|private-architecture|private-device|private-description/);
});

test("raw adapter info and malformed fingerprints fail the WebGPU receipt schema", async () => {
  const raw = await trueWebGPUReceipt() as unknown as {
    selected: { runtime: { identity: { adapterInfo: unknown } } };
  };
  raw.selected.runtime.identity.adapterInfo = {
    vendor: "raw-vendor",
    architecture: "raw-architecture",
    device: "raw-device",
    description: "raw-description"
  };
  await assert.rejects(validateAgainstSchema(raw, "webgpu-runtime-receipt.schema.json"), /adapterInfo/);

  const malformed = await trueWebGPUReceipt();
  malformed.selected.runtime.identity.adapterInfo.sha256 = "not-a-digest";
  await assert.rejects(validateAgainstSchema(malformed, "webgpu-runtime-receipt.schema.json"), /adapterInfo\/sha256/);
});
