"use client";

import { useEffect, useState } from "react";
import type { GovernedSectionKind } from "./governed-section";
import type { ProjectedMediaHook } from "./media-orchestration-stage";
import { GeneratedSectionStage } from "./generated-section-stage";

type ViewportComposition={layout:string;columns:1|2|3|4;visualOrder:string[];mediaPlacement:"before"|"after"|"background"|"none";sticky:boolean;density:"compact"|"comfortable"|"spacious";maxContentChars:number};
export type ProjectedNode={
  id:string;
  kind:GovernedSectionKind;
  variant:string;
  semanticIndex:number;
  section:{props:Record<string,unknown>};
  responsive:{mobile:ViewportComposition;tablet:ViewportComposition;desktop:ViewportComposition;coarsePointer:{hoverRequired:false;carousel:"controls"|"static";sticky:boolean};reducedMotion:{essentialOnly:true;transition:"instant"|"short"}};
  mediaHook:ProjectedMediaHook;
  motionHook:{engine:"motion"|"gsap"|"none";trigger:"enter"|"interaction"|"scroll-progress"|"route-change";durationMs:number;delayMs:number;mobile:"full"|"simplified"|"disabled";reducedMotion:"instant"|"disabled"};
};
export type ProjectedPageGraph={
  category:string;
  readiness:"READY"|"NEEDS_INPUT";
  signature:string;
  nodes:ProjectedNode[];
};

export function GeneratedPage({graph}: {graph:ProjectedPageGraph}){
  const [mounted,setMounted]=useState(true);
  useEffect(()=>{
    const unmount=()=>setMounted(false);
    window.addEventListener("wdc:generated-page:unmount",unmount);
    return()=>window.removeEventListener("wdc:generated-page:unmount",unmount);
  },[]);
  return <main className="wdc-shell" data-generated-page={graph.category} data-page-mounted={String(mounted)} data-page-readiness={graph.readiness} data-graph-signature={graph.signature}>
    {mounted?graph.nodes.map((node)=><GeneratedSectionStage key={node.id} node={node}/>):null}
  </main>;
}
