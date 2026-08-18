"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useState, type ComponentType } from "react";
import {
  fallbackAfterWebGPUFailure,
  GRAPHICS_3D_RUNTIME_BUDGETS,
  parseGraphics3DOverride,
  selectGraphics3DRenderer,
  type Graphics3DCapabilities,
  type Graphics3DRendererReceiptState,
  type Graphics3DRendererSelection,
  type WebGPUFailure,
  type WebGPUFailureDetail
} from "../../../../src/graphics-3d-renderer-policy";
import type { WebGPUSceneProps, WebGPURuntimeReceipt } from "./webgpu-scene";

const R3FScene = dynamic(() => import("./r3f-scene"), { ssr: false });

type Graphics3DState = "loading" | "ready" | "fallback";

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const available = Boolean(context);
    const lose = context?.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return available;
  } catch {
    return false;
  }
}

export function ThreeEvidence() {
  const titleId=useId();
  const [state, setState] = useState<Graphics3DState>("loading");
  const [selection, setSelection] = useState<Graphics3DRendererSelection | null>(null);
  const [capabilities, setCapabilities] = useState<Graphics3DCapabilities>({ webgpu: false, webgl: false });
  const [WebGPUScene, setWebgpuScene] = useState<ComponentType<WebGPUSceneProps> | null>(null);
  const [receiptState, setReceiptState] = useState<Graphics3DRendererReceiptState>("NOT_EXERCISED");
  const [receiptReason, setReceiptReason] = useState("renderer-selection-pending");
  const [runtimeReceipt, setRuntimeReceipt] = useState<WebGPURuntimeReceipt | null>(null);
  const [disposed, setDisposed] = useState(false);
  const [dpr, setDpr] = useState(1);
  const [forceInitializationFailure, setForceInitializationFailure] = useState(false);

  const handleReady = useCallback(() => setState("ready"), []);
  const handleDisposed = useCallback(() => setDisposed(true), []);
  const handleWebGPUReady = useCallback((receipt: WebGPURuntimeReceipt) => {
    setRuntimeReceipt(receipt);
    setReceiptState("WEBGPU_PASS");
    setReceiptReason("webgpu-runtime-observed");
    setState("ready");
  }, []);

  const handleWebGPUFailure = useCallback((failure: WebGPUFailure, detail: WebGPUFailureDetail) => {
    const fallback = fallbackAfterWebGPUFailure(capabilities.webgl, failure);
    setRuntimeReceipt(null);
    setSelection(fallback);
    setReceiptState(fallback.receiptState);
    setReceiptReason(`${fallback.reason}:${detail}`);
    setState(fallback.renderer === "static" ? "fallback" : "loading");
  }, [capabilities.webgl]);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const override = parseGraphics3DOverride(parameters.get("graphics3d"));
    const detectedCapabilities = { webgpu: "gpu" in navigator, webgl: hasWebGL() };
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const cappedDpr = Math.min(
      window.devicePixelRatio || 1,
      coarsePointer
        ? GRAPHICS_3D_RUNTIME_BUDGETS.coarsePointerDprMax
        : GRAPHICS_3D_RUNTIME_BUDGETS.desktopDprMax
    );
    const selected = selectGraphics3DRenderer(detectedCapabilities, override);
    setDpr(cappedDpr);
    setCapabilities(detectedCapabilities);
    setSelection(selected);
    setReceiptState(selected.receiptState);
    setReceiptReason(selected.reason);
    setForceInitializationFailure(parameters.get("graphics3dFailure") === "webgpu-init");
    setState(selected.renderer === "static" ? "fallback" : "loading");
  }, []);

  useEffect(() => {
    if (!selection?.loadWebgpuChunk) {
      setWebgpuScene(null);
      return;
    }

    let current = true;
    void import("./webgpu-scene")
      .then((module) => {
        if (current) setWebgpuScene(() => module.default);
      })
      .catch((error: unknown) => {
        if (current) handleWebGPUFailure("initialization-failed", "webgpu-module-import-failed");
      });
    return () => {
      current = false;
    };
  }, [handleWebGPUFailure, selection?.loadWebgpuChunk]);

  useEffect(() => {
    const disposeForVerification = () => {
      setSelection({
        renderer: "static",
        receiptState: "STATIC_FALLBACK",
        reason: "forced-runtime-disposal",
        loadWebgpuChunk: false
      });
      setReceiptState("STATIC_FALLBACK");
      setReceiptReason("forced-runtime-disposal");
      setState("fallback");
    };
    window.addEventListener("wdc:graphics3d:dispose", disposeForVerification);
    return () => window.removeEventListener("wdc:graphics3d:dispose", disposeForVerification);
  }, []);

  useEffect(() => {
    const runtimeWindow = window as typeof window & {
      __wdcGraphics3DReceipt?: {
        state: Graphics3DRendererReceiptState;
        renderer: string;
        reason: string;
        capabilities: Graphics3DCapabilities;
        runtime: WebGPURuntimeReceipt | null;
      };
    };
    runtimeWindow.__wdcGraphics3DReceipt = {
      state: receiptState,
      renderer: selection?.renderer ?? "none",
      reason: receiptReason,
      capabilities,
      runtime: runtimeReceipt
    };
  }, [capabilities, receiptReason, receiptState, runtimeReceipt, selection?.renderer]);

  return (
    <section
      aria-labelledby={titleId}
      data-graphics3d-state={state}
      data-graphics3d-enabled={String(selection !== null && selection.renderer !== "static")}
      data-graphics3d-renderer={selection?.renderer ?? "none"}
      data-graphics3d-render-state={receiptState}
      data-graphics3d-reason={receiptReason}
      data-graphics3d-webgpu-capable={String(capabilities.webgpu)}
      data-graphics3d-webgl-capable={String(capabilities.webgl)}
      data-graphics3d-three-version="0.184.0"
      data-graphics3d-tsl-module="three/tsl@0.184.0"
      data-graphics3d-frame-loop={runtimeReceipt?.budget.frameLoop ?? "demand"}
      data-graphics3d-draw-calls={runtimeReceipt?.budget.drawCalls ?? "NOT_EXERCISED"}
      data-graphics3d-triangles={runtimeReceipt?.budget.triangles ?? "NOT_EXERCISED"}
      data-graphics3d-texture-bytes={runtimeReceipt?.budget.textureBytes ?? "NOT_EXERCISED"}
      data-graphics3d-disposed={String(disposed)}
      data-graphics3d-dpr={dpr}
    >
      <h2 id={titleId}>Governed procedural 3D</h2>
      <p data-graphics3d-semantic-fallback="true">
        The procedural scene is optional illustration. Primary content and actions remain DOM-owned when WebGPU and WebGL are absent.
      </p>
      <div data-r3f-host="true" role="img" aria-label="Procedural compiler proof object">
        {selection?.renderer === "webgl" ? (
          <R3FScene dpr={dpr} onReady={handleReady} onDisposed={handleDisposed} />
        ) : null}
        {selection?.renderer === "webgpu" && WebGPUScene ? (
          <WebGPUScene
            dpr={dpr}
            maxDrawCalls={GRAPHICS_3D_RUNTIME_BUDGETS.maxDrawCalls}
            maxTriangles={GRAPHICS_3D_RUNTIME_BUDGETS.maxTriangles}
            maxTextureBytes={GRAPHICS_3D_RUNTIME_BUDGETS.maxTextureMemoryBytes}
            forceInitializationFailure={forceInitializationFailure}
            onReady={handleWebGPUReady}
            onFailure={handleWebGPUFailure}
            onDisposed={handleDisposed}
          />
        ) : null}
        {state !== "ready" ? (
          <div data-graphics3d-static-poster="true">Procedural proof: body, indicator, pivot, socket, collider.</div>
        ) : null}
      </div>
    </section>
  );
}
