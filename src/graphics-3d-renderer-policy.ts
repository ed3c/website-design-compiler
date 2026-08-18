export type Graphics3DRenderer = "webgpu" | "webgl" | "static";
export type Graphics3DRendererReceiptState =
  | "WEBGPU_PASS"
  | "WEBGL_FALLBACK"
  | "STATIC_FALLBACK"
  | "NOT_EXERCISED";
export type Graphics3DOverride = "auto" | Graphics3DRenderer;
export type WebGPUFailure = "initialization-failed" | "device-lost";
export type WebGPUFailureDetail =
  | "forced-initialization-failure"
  | "navigator-gpu-unavailable"
  | "adapter-unavailable"
  | "device-request-failed"
  | "webgpu-module-import-failed"
  | "non-webgpu-backend"
  | "budget-exceeded"
  | "device-lost"
  | "unknown-initialization-failure";

export const GRAPHICS_3D_RUNTIME_BUDGETS = Object.freeze({
  desktopDprMax: 1.75,
  coarsePointerDprMax: 1.25,
  maxDrawCalls: 8,
  maxTriangles: 2500,
  maxTextureMemoryBytes: 16_777_216,
  maxFramesPerInvalidation: 1
} as const);

export interface Graphics3DCapabilities {
  webgpu: boolean;
  webgl: boolean;
}

export interface Graphics3DRendererSelection {
  renderer: Graphics3DRenderer;
  receiptState: Graphics3DRendererReceiptState;
  reason: string;
  loadWebgpuChunk: boolean;
}

export function parseGraphics3DOverride(value: string | null): Graphics3DOverride {
  if (value === "webgpu" || value === "webgl") return value;
  if (value === "off" || value === "static") return "static";
  return "auto";
}

export function selectGraphics3DRenderer(
  capabilities: Graphics3DCapabilities,
  override: Graphics3DOverride
): Graphics3DRendererSelection {
  if (override === "static") {
    return {
      renderer: "static",
      receiptState: "STATIC_FALLBACK",
      reason: "forced-total-gpu-off",
      loadWebgpuChunk: false
    };
  }

  if (override === "webgpu") {
    if (capabilities.webgpu) {
      return {
        renderer: "webgpu",
        receiptState: "NOT_EXERCISED",
        reason: "webgpu-opt-in-capable",
        loadWebgpuChunk: true
      };
    }
    if (capabilities.webgl) {
      return {
        renderer: "webgl",
        receiptState: "WEBGL_FALLBACK",
        reason: "webgpu-capability-absent",
        loadWebgpuChunk: false
      };
    }
    return {
      renderer: "static",
      receiptState: "STATIC_FALLBACK",
      reason: "webgpu-and-webgl-capability-absent",
      loadWebgpuChunk: false
    };
  }

  if (override === "webgl" && !capabilities.webgl) {
    return {
      renderer: "static",
      receiptState: "STATIC_FALLBACK",
      reason: "webgl-capability-absent",
      loadWebgpuChunk: false
    };
  }

  if (capabilities.webgl) {
    return {
      renderer: "webgl",
      receiptState: "WEBGL_FALLBACK",
      reason: override === "webgl" ? "forced-webgl" : "stable-webgl-default",
      loadWebgpuChunk: false
    };
  }

  return {
    renderer: "static",
    receiptState: "STATIC_FALLBACK",
    reason: "webgl-capability-absent",
    loadWebgpuChunk: false
  };
}

export function fallbackAfterWebGPUFailure(
  webglAvailable: boolean,
  failure: WebGPUFailure
): Graphics3DRendererSelection {
  return {
    renderer: webglAvailable ? "webgl" : "static",
    receiptState: webglAvailable ? "WEBGL_FALLBACK" : "STATIC_FALLBACK",
    reason: `webgpu-${failure}`,
    loadWebgpuChunk: false
  };
}
