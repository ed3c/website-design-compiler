"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { createProceduralFixture, disposeProceduralFixture } from "./procedural-fixture";

function ProceduralObject() {
  const object = useMemo(() => createProceduralFixture(), []);

  useEffect(() => () => disposeProceduralFixture(object), [object]);

  return <primitive object={object} dispose={null} />;
}

export interface R3FSceneProps {
  dpr: number;
  onReady: () => void;
}

export default function R3FScene({ dpr, onReady }: R3FSceneProps) {
  return (
    <Canvas
      frameloop="demand"
      dpr={dpr}
      camera={{ position: [2.8, 2, 4.2], fov: 42, near: 0.1, far: 50 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.domElement.dataset.r3fCanvas = "true";
        gl.domElement.dataset.r3fDpr = String(gl.getPixelRatio());
        gl.domElement.setAttribute("aria-hidden", "true");
        onReady();
      }}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 4, 5]} intensity={1.45} />
      <directionalLight position={[-3, 1, 2]} intensity={0.55} />
      <group rotation={[0.08, -0.45, 0]}>
        <ProceduralObject />
      </group>
    </Canvas>
  );
}
