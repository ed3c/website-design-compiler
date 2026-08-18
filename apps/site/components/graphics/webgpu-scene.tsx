"use client";

import { useEffect, useRef } from "react";
import type { WebGPUFailureDetail } from "../../../../src/graphics-3d-renderer-policy";
import { buildWebGPUAdapterInfoEvidence, type WebGPUAdapterInfoEvidence } from "../../../../src/webgpu-runtime-identity";

class WebGPUSceneError extends Error {
  constructor(readonly code: WebGPUFailureDetail) {
    super(code);
  }
}

export interface WebGPURuntimeIdentity {
  adapter: "navigator.gpu";
  renderer: "three.WebGPURenderer";
  rendererVersion: "0.184.0";
  tslModule: "three/tsl@0.184.0";
  adapterInfo: WebGPUAdapterInfoEvidence;
  features: string[];
  limits: {
    maxTextureDimension2D: number | null;
    maxBindGroups: number | null;
    maxBufferSize: number | null;
  };
}

export interface WebGPURuntimeBudgetEvidence {
  dpr: number;
  drawCalls: number;
  triangles: number;
  textureBytes: number;
  framesRendered: number;
  frameLoop: "demand";
}

export interface WebGPURuntimeReceipt {
  state: "WEBGPU_PASS";
  identity: WebGPURuntimeIdentity;
  budget: WebGPURuntimeBudgetEvidence;
}

export interface WebGPUSceneProps {
  dpr: number;
  maxDrawCalls: number;
  maxTriangles: number;
  maxTextureBytes: number;
  forceInitializationFailure: boolean;
  onReady(receipt: WebGPURuntimeReceipt): void;
  onFailure(failure: "initialization-failed" | "device-lost", detail: WebGPUFailureDetail): void;
  onDisposed(): void;
}

function numericLimit(limits: object, key: string): number | null {
  const value = Reflect.get(limits, key) as unknown;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function failureDetail(value: unknown): WebGPUFailureDetail {
  return value instanceof WebGPUSceneError ? value.code : "unknown-initialization-failure";
}

export default function WebGPUScene({
  dpr,
  maxDrawCalls,
  maxTriangles,
  maxTextureBytes,
  forceInitializationFailure,
  onReady,
  onFailure,
  onDisposed
}: WebGPUSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let disposed = false;
    let disposeRuntime = () => {};

    const fail = (failure: "initialization-failed" | "device-lost", detail: WebGPUFailureDetail) => {
      if (cancelled || disposed) return;
      onFailure(failure, detail);
    };

    async function boot() {
      const host = hostRef.current;
      if (!host) return;

      try {
        if (forceInitializationFailure) throw new WebGPUSceneError("forced-initialization-failure");

        const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
        if (!gpu) throw new WebGPUSceneError("navigator-gpu-unavailable");

        const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) throw new WebGPUSceneError("adapter-unavailable");

        let device: GPUDevice;
        try {
          device = await adapter.requestDevice({ requiredFeatures: [] });
        } catch {
          throw new WebGPUSceneError("device-request-failed");
        }
        disposeRuntime = () => device.destroy();
        if (cancelled) {
          device.destroy();
          return;
        }

        let three: typeof import("three/webgpu");
        let tsl: typeof import("three/tsl");
        try {
          [three, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
        } catch {
          throw new WebGPUSceneError("webgpu-module-import-failed");
        }
        if (cancelled) {
          device.destroy();
          return;
        }

        const renderer = new three.WebGPURenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
          device
        });
        renderer.setPixelRatio(dpr);
        renderer.setSize(Math.max(host.clientWidth, 320), 220);

        let runtimeDisposed = false;
        const geometry = new three.BoxGeometry(1.6, 0.72, 0.8);
        const material = new three.MeshStandardNodeMaterial();
        material.colorNode = tsl.color(0x2563eb);
        material.roughnessNode = tsl.float(0.55);
        material.metalnessNode = tsl.float(0.08);

        const scene = new three.Scene();
        const camera = new three.PerspectiveCamera(42, Math.max(host.clientWidth, 320) / 220, 0.1, 50);
        camera.position.set(2.8, 2, 4.2);
        camera.lookAt(0, 0, 0);
        const mesh = new three.Mesh(geometry, material);
        mesh.rotation.set(0.08, -0.45, 0);
        scene.add(mesh);
        scene.add(new three.AmbientLight(0xffffff, 0.85));
        const keyLight = new three.DirectionalLight(0xffffff, 1.45);
        keyLight.position.set(3, 4, 5);
        scene.add(keyLight);

        const dispose = () => {
          if (runtimeDisposed) return;
          runtimeDisposed = true;
          geometry.dispose();
          material.dispose();
          renderer.dispose();
          device.destroy();
          renderer.domElement.remove();
          host.dataset.webgpuDisposed = "true";
          onDisposed();
        };
        disposeRuntime = dispose;

        renderer.onDeviceLost = (info) => {
          fail("device-lost", "device-lost");
        };
        void device.lost.then((info) => {
          if (!runtimeDisposed && info.reason !== "destroyed") {
            fail("device-lost", "device-lost");
          }
        });

        await renderer.init();
        if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
          throw new WebGPUSceneError("non-webgpu-backend");
        }

        renderer.domElement.dataset.webgpuCanvas = "true";
        renderer.domElement.setAttribute("aria-hidden", "true");
        host.appendChild(renderer.domElement);
        await renderer.renderAsync(scene, camera);

        const evidence: WebGPURuntimeBudgetEvidence = {
          dpr,
          drawCalls: renderer.info.render.drawCalls,
          triangles: renderer.info.render.triangles,
          textureBytes: renderer.info.memory.texturesSize,
          framesRendered: 1,
          frameLoop: "demand"
        };
        if (
          evidence.drawCalls > maxDrawCalls ||
          evidence.triangles > maxTriangles ||
          evidence.textureBytes > maxTextureBytes
        ) {
          throw new WebGPUSceneError("budget-exceeded");
        }

        const adapterInfo = adapter.info ?? {};
        const adapterInfoEvidence = await buildWebGPUAdapterInfoEvidence(adapterInfo);
        onReady({
          state: "WEBGPU_PASS",
          identity: {
            adapter: "navigator.gpu",
            renderer: "three.WebGPURenderer",
            rendererVersion: "0.184.0",
            tslModule: "three/tsl@0.184.0",
            adapterInfo: adapterInfoEvidence,
            features: [...adapter.features.keys()].sort(),
            limits: {
              maxTextureDimension2D: numericLimit(device.limits, "maxTextureDimension2D"),
              maxBindGroups: numericLimit(device.limits, "maxBindGroups"),
              maxBufferSize: numericLimit(device.limits, "maxBufferSize")
            }
          },
          budget: evidence
        });

        const renderOnce = () => {
          if (runtimeDisposed) return;
          renderer.setSize(Math.max(host.clientWidth, 320), 220);
          camera.aspect = Math.max(host.clientWidth, 320) / 220;
          camera.updateProjectionMatrix();
          void renderer.renderAsync(scene, camera);
        };
        window.addEventListener("resize", renderOnce);
        const forceDeviceLoss = () => {
          fail("device-lost", "device-lost");
          device.destroy();
        };
        window.addEventListener("wdc:graphics3d:webgpu-device-loss", forceDeviceLoss);

        disposeRuntime = () => {
          window.removeEventListener("resize", renderOnce);
          window.removeEventListener("wdc:graphics3d:webgpu-device-loss", forceDeviceLoss);
          dispose();
        };
      } catch (error) {
        disposeRuntime();
        fail("initialization-failed", failureDetail(error));
      }
    }

    void boot();
    return () => {
      cancelled = true;
      disposeRuntime();
      disposed = true;
    };
  }, [
    dpr,
    forceInitializationFailure,
    maxDrawCalls,
    maxTextureBytes,
    maxTriangles,
    onDisposed,
    onFailure,
    onReady
  ]);

  return <div ref={hostRef} data-webgpu-host="true" />;
}
