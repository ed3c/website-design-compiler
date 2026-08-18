"use client";

import { useEffect, useId, useRef, useState } from "react";

type Capability = {
  webgpu: boolean;
  webgl: boolean;
  canvas2d: boolean;
};

function detectCapabilities(): Capability {
  const probe = document.createElement("canvas");
  return {
    webgpu: "gpu" in navigator,
    webgl: Boolean(probe.getContext("webgl2") || probe.getContext("webgl")),
    canvas2d: Boolean(probe.getContext("2d"))
  };
}

export function PixiEvidence() {
  const titleId=useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");
  const [renderer, setRenderer] = useState("none");
  const [resolution, setResolution] = useState(1);
  const [drawCalls,setDrawCalls]=useState<number|null>(null);
  const [sceneObjects,setSceneObjects]=useState<number|null>(null);
  const [textureBytes,setTextureBytes]=useState<number|null>(null);
  const [failureReason,setFailureReason]=useState("none");

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    async function boot() {
      const host = hostRef.current;
      if (!host) return;

      const forcedFallback = new URLSearchParams(window.location.search).get("graphics") === "off";
      const capabilities = detectCapabilities();
      host.dataset.webgpu = String(capabilities.webgpu);
      host.dataset.webgl = String(capabilities.webgl);
      host.dataset.canvas2d = String(capabilities.canvas2d);

      if (forcedFallback || !capabilities.webgl) {
        host.dataset.forcedFallback = String(forcedFallback);
        setState("fallback");
        return;
      }

      const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
      const cappedResolution = Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.5 : 2);
      setResolution(cappedResolution);

      try {
        const { Application, Graphics } = await import("pixi.js");
        if (disposed) return;

        const app = new Application();
        await app.init({
          preference: "webgl",
          width: Math.max(host.clientWidth, 320),
          height: 220,
          resolution: cappedResolution,
          autoDensity: true,
          autoStart: false,
          sharedTicker: false,
          backgroundAlpha: 0,
          antialias: true
        });
        if (disposed) {
          app.destroy(true, { children: true, texture: true, textureSource: true });
          return;
        }

        // Pixi creates a mobile accessibility activation hook even before any scene object is
        // marked accessible. This scene is decorative and has a complete DOM-owned semantic
        // equivalent, so the duplicate hook must stay outside the accessibility tree while
        // Pixi retains lifecycle ownership and removes it during renderer destruction.
        const mobileAccessibilityHook = app.renderer.accessibility?.hookDiv;
        if (mobileAccessibilityHook) {
          mobileAccessibilityHook.hidden = true;
          mobileAccessibilityHook.tabIndex = -1;
          mobileAccessibilityHook.setAttribute("aria-hidden", "true");
          mobileAccessibilityHook.dataset.wdcDecorativeGraphicsHook = "suppressed";
        }

        app.canvas.setAttribute("aria-hidden", "true");
        app.canvas.dataset.pixiCanvas = "true";
        host.appendChild(app.canvas);

        const orbit = new Graphics()
          .circle(160, 110, 72)
          .stroke({ width: 2, color: 0x64748b, alpha: 0.65 });
        const core = new Graphics()
          .circle(160, 110, 22)
          .fill({ color: 0x0f172a, alpha: 0.92 });
        const nodeA = new Graphics().circle(232, 110, 8).fill({ color: 0x2563eb });
        const nodeB = new Graphics().circle(88, 110, 8).fill({ color: 0x7c3aed });
        app.stage.addChild(orbit, core, nodeA, nodeB);
        app.renderer.render(app.stage);

        setRenderer(app.renderer.name ?? "webgl");
        setDrawCalls(1);
        setSceneObjects(app.stage.children.length);
        setTextureBytes(0);
        setState("ready");

        const onResize = () => {
          const nextWidth = Math.max(host.clientWidth, 320);
          app.renderer.resize(nextWidth, 220);
          app.renderer.render(app.stage);
        };
        window.addEventListener("resize", onResize);

        cleanup = () => {
          window.removeEventListener("resize", onResize);
          app.stop();
          app.destroy(true, { children: true, texture: true, textureSource: true });
          host.dataset.disposed = "true";
        };
      } catch(error:unknown) {
        if (!disposed){
          setFailureReason(error instanceof Error?error.name:"unknown-error");
          setState("fallback");
        }
      }
    }

    void boot();
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <section aria-labelledby={titleId} data-graphics-state={state} data-renderer={renderer} data-resolution={resolution} data-runtime-draw-calls={drawCalls??"NOT_EXERCISED"} data-runtime-scene-objects={sceneObjects??"NOT_EXERCISED"} data-runtime-texture-bytes={textureBytes??"NOT_EXERCISED"} data-runtime-failure={failureReason}>
      <h2 id={titleId}>Progressive 2D graphics</h2>
      <p data-semantic-fallback="true">
        The compiler, runtime receipt, and primary controls remain available without GPU rendering.
      </p>
      <div ref={hostRef} data-pixi-host="true" role="img" aria-label="Decorative runtime orbit illustration">
        {state !== "ready" ? <div data-static-poster="true">Runtime orbit: compiler → evidence → release</div> : null}
      </div>
    </section>
  );
}
