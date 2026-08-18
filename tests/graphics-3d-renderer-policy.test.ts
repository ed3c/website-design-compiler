import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackAfterWebGPUFailure,
  parseGraphics3DOverride,
  selectGraphics3DRenderer
} from "../src/graphics-3d-renderer-policy.js";

test("stable auto policy keeps WebGL as the default even when WebGPU exists", () => {
  const selection = selectGraphics3DRenderer(
    { webgpu: true, webgl: true },
    "auto"
  );

  assert.deepEqual(selection, {
    renderer: "webgl",
    receiptState: "WEBGL_FALLBACK",
    reason: "stable-webgl-default",
    loadWebgpuChunk: false
  });
});

test("explicit WebGPU opt-in is capability-gated and remains unexercised until runtime init", () => {
  const selection = selectGraphics3DRenderer(
    { webgpu: true, webgl: true },
    "webgpu"
  );

  assert.deepEqual(selection, {
    renderer: "webgpu",
    receiptState: "NOT_EXERCISED",
    reason: "webgpu-opt-in-capable",
    loadWebgpuChunk: true
  });
});

test("forced renderer overrides degrade deterministically", () => {
  assert.equal(parseGraphics3DOverride("webgpu"), "webgpu");
  assert.equal(parseGraphics3DOverride("webgl"), "webgl");
  assert.equal(parseGraphics3DOverride("off"), "static");
  assert.equal(parseGraphics3DOverride("unknown"), "auto");

  assert.deepEqual(
    selectGraphics3DRenderer({ webgpu: false, webgl: true }, "webgpu"),
    {
      renderer: "webgl",
      receiptState: "WEBGL_FALLBACK",
      reason: "webgpu-capability-absent",
      loadWebgpuChunk: false
    }
  );
  assert.deepEqual(
    selectGraphics3DRenderer({ webgpu: true, webgl: false }, "webgl"),
    {
      renderer: "static",
      receiptState: "STATIC_FALLBACK",
      reason: "webgl-capability-absent",
      loadWebgpuChunk: false
    }
  );
  assert.deepEqual(
    selectGraphics3DRenderer({ webgpu: true, webgl: true }, "static"),
    {
      renderer: "static",
      receiptState: "STATIC_FALLBACK",
      reason: "forced-total-gpu-off",
      loadWebgpuChunk: false
    }
  );
});

test("WebGPU init or device-loss failure falls back without retry loops", () => {
  assert.deepEqual(fallbackAfterWebGPUFailure(true, "device-lost"), {
    renderer: "webgl",
    receiptState: "WEBGL_FALLBACK",
    reason: "webgpu-device-lost",
    loadWebgpuChunk: false
  });
  assert.deepEqual(fallbackAfterWebGPUFailure(false, "initialization-failed"), {
    renderer: "static",
    receiptState: "STATIC_FALLBACK",
    reason: "webgpu-initialization-failed",
    loadWebgpuChunk: false
  });
});
