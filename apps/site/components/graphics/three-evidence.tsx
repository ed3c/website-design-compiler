"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

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
  const [state, setState] = useState<Graphics3DState>("loading");
  const [enabled, setEnabled] = useState(false);
  const [disposed, setDisposed] = useState(false);
  const [dpr, setDpr] = useState(1);

  const handleReady = useCallback(() => setState("ready"), []);
  const handleDisposed = useCallback(() => setDisposed(true), []);

  useEffect(() => {
    const forcedFallback = new URLSearchParams(window.location.search).get("graphics3d") === "off";
    const webgl = hasWebGL();
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const cappedDpr = Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.25 : 1.75);
    setDpr(cappedDpr);

    if (forcedFallback || !webgl) {
      setEnabled(false);
      setState("fallback");
      return;
    }

    setEnabled(true);
  }, []);

  useEffect(() => {
    const disposeForVerification = () => {
      setEnabled(false);
      setState("fallback");
    };
    window.addEventListener("wdc:graphics3d:dispose", disposeForVerification);
    return () => window.removeEventListener("wdc:graphics3d:dispose", disposeForVerification);
  }, []);

  return (
    <section
      aria-labelledby="graphics-3d-title"
      data-graphics3d-state={state}
      data-graphics3d-enabled={String(enabled)}
      data-graphics3d-disposed={String(disposed)}
      data-graphics3d-dpr={dpr}
    >
      <h2 id="graphics-3d-title">Governed procedural 3D</h2>
      <p data-graphics3d-semantic-fallback="true">
        The procedural scene is optional illustration. Primary content and actions remain DOM-owned when WebGL is absent.
      </p>
      <div data-r3f-host="true" role="img" aria-label="Procedural compiler proof object">
        {enabled ? <R3FScene dpr={dpr} onReady={handleReady} onDisposed={handleDisposed} /> : null}
        {state !== "ready" ? (
          <div data-graphics3d-static-poster="true">Procedural proof: body, indicator, pivot, socket, collider.</div>
        ) : null}
      </div>
    </section>
  );
}
