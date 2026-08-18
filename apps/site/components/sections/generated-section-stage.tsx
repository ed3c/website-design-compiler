"use client";

import { gsap } from "gsap";
import { motion, useAnimationControls } from "motion/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { GovernedSection } from "./governed-section";
import { MediaOrchestrationStage } from "./media-orchestration-stage";
import type { ProjectedNode } from "./generated-page";

type ViewportName="mobile"|"tablet"|"desktop";
type MotionRuntimeState="PENDING"|"ACTIVE"|"SETTLED"|"VISIBLE_NO_MOTION"|"CLEANED";

type RuntimeWindow=typeof window&{
  __wdcGeneratedMotion?:{active:number;peak:number;layoutPropertiesAnimated:boolean};
};

const MAX_CONCURRENT=3;
const waiters:Array<()=>void>=[];
let activeEffects=0;

function motionMetrics(){
  const runtimeWindow=window as RuntimeWindow;
  runtimeWindow.__wdcGeneratedMotion??={active:0,peak:0,layoutPropertiesAnimated:false};
  return runtimeWindow.__wdcGeneratedMotion;
}

async function acquireMotionSlot(signal:AbortSignal):Promise<()=>void>{
  if(signal.aborted)throw new DOMException("generated motion aborted","AbortError");
  if(activeEffects>=MAX_CONCURRENT){
    await new Promise<void>((resolve,reject)=>{
      const resume=()=>{signal.removeEventListener("abort",abort);resolve();};
      const abort=()=>{const index=waiters.indexOf(resume);if(index>=0)waiters.splice(index,1);reject(new DOMException("generated motion aborted","AbortError"));};
      waiters.push(resume);
      signal.addEventListener("abort",abort,{once:true});
    });
  }
  if(signal.aborted)throw new DOMException("generated motion aborted","AbortError");
  activeEffects+=1;
  const metrics=motionMetrics();
  metrics.active=activeEffects;
  metrics.peak=Math.max(metrics.peak,activeEffects);
  let released=false;
  return()=>{
    if(released)return;
    released=true;
    activeEffects=Math.max(0,activeEffects-1);
    motionMetrics().active=activeEffects;
    waiters.shift()?.();
  };
}

function viewportName():ViewportName{
  if(window.matchMedia("(max-width: 47.999rem)").matches)return"mobile";
  if(window.matchMedia("(max-width: 63.999rem)").matches)return"tablet";
  return"desktop";
}

function text(value:unknown):string|undefined{return typeof value==="string"?value:undefined;}
function items(value:unknown):string[]{if(!Array.isArray(value))return[];return value.map((entry)=>typeof entry==="string"?entry:entry&&typeof entry==="object"&&"value" in entry?String((entry as {value:unknown}).value):"").filter(Boolean);}
function safeActionHref(value:string):boolean{return value.startsWith("#")||value.startsWith("/")||value.startsWith("https://");}
function content(node:ProjectedNode){
  const props=node.section.props;
  const candidate=props.action;
  const action=candidate&&typeof candidate==="object"&&"label" in candidate&&"href" in candidate&&typeof candidate.label==="string"&&typeof candidate.href==="string"&&safeActionHref(candidate.href)?{label:candidate.label,href:candidate.href}:undefined;
  return{heading:text(props.heading)??text(props.headline)??text(props.title),body:text(props.body)??text(props.quote)??text(props.summary)??text(props.description),items:items(props.items),action};
}

function densityGap(density:"compact"|"comfortable"|"spacious"):string{return density==="compact"?"var(--wdc-space-sm)":density==="comfortable"?"var(--wdc-space-md)":"var(--wdc-space-lg)";}

export function GeneratedSectionStage({node}:{node:ProjectedNode}){
  const hostRef=useRef<HTMLDivElement>(null);
  const controls=useAnimationControls();
  const [viewport,setViewport]=useState<ViewportName>("desktop");
  const [runtimeState,setRuntimeState]=useState<MotionRuntimeState>("PENDING");
  const [cleanupObserved,setCleanupObserved]=useState(false);
  const copy=content(node);
  const selected=node.responsive[viewport];

  useEffect(()=>{
    const queries=[window.matchMedia("(max-width: 47.999rem)"),window.matchMedia("(max-width: 63.999rem)")];
    const update=()=>setViewport(viewportName());
    update();
    for(const query of queries)query.addEventListener("change",update);
    return()=>{for(const query of queries)query.removeEventListener("change",update);};
  },[]);

  const settle=useCallback(()=>{
    controls.set({opacity:1,transform:"none"});
    setRuntimeState("CLEANED");
    setCleanupObserved(true);
  },[controls]);

  useEffect(()=>{
    const element=hostRef.current;
    if(!element)return;
    const controller=new AbortController();
    let release:undefined|(()=>void);
    let context:gsap.Context|undefined;
    let intersection:IntersectionObserver|undefined;
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse=window.matchMedia("(pointer: coarse)").matches;
    element.dataset.reducedMotion=String(reduced);
    element.dataset.coarsePointer=String(coarse);

    const cleanup=()=>{
      controller.abort();
      intersection?.disconnect();
      context?.revert();
      release?.();
      release=undefined;
      element.style.opacity="1";
      element.style.transform="none";
      setRuntimeState("CLEANED");
      setCleanupObserved(true);
    };
    window.addEventListener("wdc:generated-motion:route-change",cleanup);

    if(reduced||node.motionHook.engine==="none"||(coarse&&node.motionHook.mobile==="disabled")){
      element.style.opacity="1";
      element.style.transform="none";
      setRuntimeState("VISIBLE_NO_MOTION");
      return()=>{window.removeEventListener("wdc:generated-motion:route-change",cleanup);cleanup();};
    }

    const run=async()=>{
      release=await acquireMotionSlot(controller.signal);
      if(controller.signal.aborted){release();return;}
      setRuntimeState("ACTIVE");
      if(node.motionHook.engine==="motion"){
        controls.set({opacity:0.72,y:coarse?4:10});
        await controls.start({opacity:1,y:0,transition:{duration:node.motionHook.durationMs/1000,delay:node.motionHook.delayMs/1000,ease:[0.22,1,0.36,1]}});
      }else{
        context=gsap.context(()=>{
          gsap.fromTo(element,{opacity:0.78,y:coarse?4:12},{opacity:1,y:0,duration:node.motionHook.durationMs/1000,delay:node.motionHook.delayMs/1000,ease:"power2.out",overwrite:"auto",onComplete:()=>{
            release?.();release=undefined;setRuntimeState("SETTLED");
          }});
        },element);
        return;
      }
      release?.();release=undefined;
      setRuntimeState("SETTLED");
    };
    const start=()=>void run().catch((error:unknown)=>{if(!(error instanceof DOMException&&error.name==="AbortError"))throw error;});
    if(node.motionHook.trigger==="scroll-progress"&&"IntersectionObserver" in window){
      intersection=new IntersectionObserver((entries)=>{if(entries.some((entry)=>entry.isIntersecting)){intersection?.disconnect();start();}},{rootMargin:"120px"});
      intersection.observe(element);
    }else start();
    return()=>{window.removeEventListener("wdc:generated-motion:route-change",cleanup);cleanup();};
  },[controls,node.motionHook]);

  const styles={
    "--wdc-mobile-columns":node.responsive.mobile.columns,
    "--wdc-tablet-columns":node.responsive.tablet.columns,
    "--wdc-desktop-columns":node.responsive.desktop.columns,
    "--wdc-mobile-gap":densityGap(node.responsive.mobile.density),
    "--wdc-tablet-gap":densityGap(node.responsive.tablet.density),
    "--wdc-desktop-gap":densityGap(node.responsive.desktop.density)
  } as CSSProperties;
  const contentOrder=selected.visualOrder.indexOf("content");
  const mediaOrder=selected.visualOrder.indexOf("media");
  const contentLength=[copy.heading,copy.body,...copy.items].filter(Boolean).join(" ").length;

  return <motion.div
    ref={hostRef}
    animate={controls}
    initial={false}
    className="wdc-generated-node"
    style={styles}
    data-page-node={node.id}
    data-semantic-index={node.semanticIndex}
    data-current-viewport={viewport}
    data-active-layout={selected.layout}
    data-active-columns={selected.columns}
    data-active-density={selected.density}
    data-active-media-placement={selected.mediaPlacement}
    data-mobile-layout={node.responsive.mobile.layout}
    data-tablet-layout={node.responsive.tablet.layout}
    data-desktop-layout={node.responsive.desktop.layout}
    data-content-budget={selected.maxContentChars}
    data-content-length={contentLength}
    data-content-budget-state={contentLength<=selected.maxContentChars?"PASS":"FAIL"}
    data-media-renderer={node.mediaHook.renderer}
    data-motion-engine={node.motionHook.engine}
    data-motion-trigger={node.motionHook.trigger}
    data-motion-runtime={runtimeState}
    data-motion-cleanup-observed={String(cleanupObserved)}
  >
    <div className="wdc-generated-node__content" style={{order:contentOrder}}>
      <GovernedSection kind={node.kind} variant={node.variant} heading={copy.heading} body={copy.body} items={copy.items} action={copy.action}/>
    </div>
    {node.mediaHook.renderer!=="dom"?<div className="wdc-generated-node__media" style={{order:mediaOrder}}><MediaOrchestrationStage sectionId={node.id} decision={node.mediaHook}/></div>:null}
  </motion.div>;
}
