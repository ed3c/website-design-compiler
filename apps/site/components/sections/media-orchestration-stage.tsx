"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const PixiEvidence=dynamic(()=>import("../graphics/pixi-evidence").then((module)=>module.PixiEvidence),{ssr:false});
const ThreeEvidence=dynamic(()=>import("../graphics/three-evidence").then((module)=>module.ThreeEvidence),{ssr:false});

export type ProjectedMediaHook={
  renderer:"dom"|"image"|"video"|"pixi"|"three";
  purpose:string;
  criticality:"primary"|"supporting"|"decorative";
  lazyPriority:"eager"|"viewport"|"idle";
  budget:{maxBytes:number;maxDpr:number;maxTriangles:number;maxDrawCalls:number};
  execution:{provider:string;state:"NO_JOB"|"READY_INTERNAL"|"PROVIDER_NOT_ADMITTED";provenanceRequired:boolean};
};

type RuntimeState="PENDING"|"ACTIVE"|"DOM_FALLBACK";

export function MediaOrchestrationStage({sectionId,decision}:{sectionId:string;decision:ProjectedMediaHook}){
  const hostRef=useRef<HTMLDivElement>(null);
  const [state,setState]=useState<RuntimeState>("PENDING");
  const [activation,setActivation]=useState("pending");

  useEffect(()=>{
    const forcedOff=new URLSearchParams(window.location.search).get("media")==="off";
    const assetSourceAbsent=(decision.renderer==="image"||decision.renderer==="video")&&decision.execution.state!=="READY_INTERNAL";
    if(forcedOff||decision.execution.state==="PROVIDER_NOT_ADMITTED"||assetSourceAbsent){
      setActivation(forcedOff?"forced-off":decision.execution.state==="PROVIDER_NOT_ADMITTED"?"provider-not-admitted":"asset-source-absent");
      setState("DOM_FALLBACK");
      return;
    }
    if(decision.renderer==="image"||decision.renderer==="video"){
      setActivation("asset-renderer-not-implemented");
      setState("DOM_FALLBACK");
      return;
    }
    if(decision.renderer==="dom"){
      setActivation("not-required");
      setState("DOM_FALLBACK");
      return;
    }
    const activate=(reason:string)=>{setActivation(reason);setState("ACTIVE");};
    if(decision.lazyPriority==="eager"){
      activate("eager");
      return;
    }
    if(decision.lazyPriority==="viewport"){
      if(!("IntersectionObserver" in window)){
        activate("viewport-api-unavailable");
        return;
      }
      const observer=new IntersectionObserver((entries)=>{
        if(entries.some((entry)=>entry.isIntersecting)){activate("viewport");observer.disconnect();}
      },{rootMargin:"160px"});
      if(hostRef.current)observer.observe(hostRef.current);
      return()=>observer.disconnect();
    }
    const runtimeWindow=window as typeof window&{requestIdleCallback?:(callback:()=>void,options?:{timeout:number})=>number;cancelIdleCallback?:(id:number)=>void};
    if(runtimeWindow.requestIdleCallback){
      const id=runtimeWindow.requestIdleCallback(()=>activate("idle"),{timeout:1_500});
      return()=>runtimeWindow.cancelIdleCallback?.(id);
    }
    const timer=window.setTimeout(()=>activate("idle-timeout"),250);
    return()=>window.clearTimeout(timer);
  },[decision.execution.state,decision.lazyPriority,decision.renderer]);

  return <div
    ref={hostRef}
    data-orchestrated-media={sectionId}
    data-media-requested-renderer={decision.renderer}
    data-media-runtime-state={state}
    data-media-activation={activation}
    data-media-lazy-priority={decision.lazyPriority}
    data-media-criticality={decision.criticality}
    data-media-max-bytes={decision.budget.maxBytes}
    data-media-max-dpr={decision.budget.maxDpr}
    data-media-max-triangles={decision.budget.maxTriangles}
    data-media-max-draw-calls={decision.budget.maxDrawCalls}
    data-media-provider={decision.execution.provider}
    data-media-provider-state={decision.execution.state}
  >
    {state==="ACTIVE"&&decision.renderer==="pixi"?<PixiEvidence/>:null}
    {state==="ACTIVE"&&decision.renderer==="three"?<ThreeEvidence/>:null}
    {state==="DOM_FALLBACK"?<div data-media-static-poster="true" role="img" aria-label={`${decision.purpose} media is represented by a governed static fallback`}>
      Optional media is unavailable; the complete section remains in semantic HTML.
    </div>:null}
  </div>;
}
