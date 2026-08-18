"use client";

import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Mesh, Texture } from "three";
import { createProceduralFixture, disposeProceduralFixture } from "./procedural-fixture";

function ProceduralObject() {
  const object = useMemo(() => createProceduralFixture(), []);

  useEffect(() => () => disposeProceduralFixture(object), [object]);

  return <primitive object={object} dispose={null} />;
}

export interface R3FSceneProps {
  dpr: number;
  onReady: () => void;
  onDisposed: () => void;
  onMetrics:(metrics:{drawCalls:number;triangles:number;textureCount:number;textureBytes:number|null;dpr:number})=>void;
}

function authoredTextureMetrics(scene:RootState["scene"]):{textureCount:number;textureBytes:number|null}{
  const textures=new Set<Texture>();
  scene.traverse((object)=>{
    if(!(object instanceof Mesh))return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    for(const material of materials)for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);
  });
  let bytes=0;
  for(const texture of textures){
    const source=texture.source.data as {width?:unknown;height?:unknown}|null;
    if(!source||typeof source.width!=="number"||typeof source.height!=="number")return{textureCount:textures.size,textureBytes:null};
    bytes+=source.width*source.height*4;
  }
  return{textureCount:textures.size,textureBytes:bytes};
}

function RuntimeMetrics({onMetrics}:{onMetrics:R3FSceneProps["onMetrics"]}){
  const gl=useThree((state)=>state.gl);
  const scene=useThree((state)=>state.scene);
  const invalidate=useThree((state)=>state.invalidate);
  const frames=useRef(0);
  useFrame(()=>{
    frames.current+=1;
    if(frames.current===1){invalidate();return;}
    if(frames.current>2)return;
    onMetrics({drawCalls:gl.info.render.calls,triangles:gl.info.render.triangles,...authoredTextureMetrics(scene),dpr:gl.getPixelRatio()});
  });
  return null;
}

export default function R3FScene({ dpr, onReady, onDisposed,onMetrics }: R3FSceneProps) {
  useEffect(() => () => onDisposed(), [onDisposed]);

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
      <RuntimeMetrics onMetrics={onMetrics}/>
    </Canvas>
  );
}
