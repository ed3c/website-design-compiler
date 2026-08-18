import type { SectionKind } from "./section-grammar";
import type { SectionPageSource } from "./section-page-source.js";
import { compileResponsiveSectionPolicy } from "./responsive-composition";

export type MediaRenderer="dom"|"image"|"video"|"pixi"|"three";
export type MediaPurpose="none"|"explain"|"demonstrate"|"editorial-support"|"ambient-brand"|"interactive-exploration";
export interface MediaDecision {
  sectionId:string; kind:SectionKind; renderer:MediaRenderer; purpose:MediaPurpose; justification:string;
  criticality:"primary"|"supporting"|"decorative"; lazyPriority:"eager"|"viewport"|"idle";
  budget:{maxBytes:number;maxDpr:number;maxTriangles:number;maxDrawCalls:number};
  accessibility:{semanticOwner:"DOM";altRequired:boolean;descriptionRequired:boolean;canvasAriaHidden:boolean};
  fallback:{mobile:MediaRenderer;gpuFailure:MediaRenderer;providerFailure:MediaRenderer;reducedMotion:MediaRenderer};
  execution:{provider:"NONE"|"internal-deterministic-mock"|"PRODUCTION_PROVIDER_REQUIRED";state:"NO_JOB"|"READY_INTERNAL"|"PROVIDER_NOT_ADMITTED";provenanceRequired:boolean};
}
export interface MediaOrchestrationPlan { schema:"website-design-compiler/media-orchestration/v2";category:string;decisions:MediaDecision[];richMediaCount:number;gpuCount:number;providerBlockedCount:number;strategySignature:string; }
function choose(category: string, kind: SectionKind): MediaRenderer {
  if (kind === "graphics-2d-stage") return "pixi";
  if (kind === "graphics-3d-stage") return "three";
  if (kind === "editorial-media") return "image";
  if (kind === "media-stage") {
    return category === "motion-heavy-creative" ? "video" : "image";
  }
  if (kind === "product-showcase") {
    if (category === "interactive-3d") return "three";
    return category === "premium-consumer-brand" ? "image" : "dom";
  }
  if (kind === "hero") {
    if (category === "premium-consumer-brand") return "image";
    if (category === "motion-heavy-creative") return "video";
    if (category === "interactive-2d") return "pixi";
    if (category === "interactive-3d") return "three";
  }
  return "dom";
}
function purpose(renderer:MediaRenderer,kind:SectionKind):MediaPurpose{if(renderer==="dom")return"none";if(kind==="editorial-media")return"editorial-support";if(renderer==="pixi"||renderer==="three")return"interactive-exploration";if(kind==="hero")return"ambient-brand";return"demonstrate";}
function fallback(renderer:MediaRenderer):MediaDecision["fallback"]{if(renderer==="three"||renderer==="pixi")return{mobile:"image",gpuFailure:"image",providerFailure:"dom",reducedMotion:"image"};if(renderer==="video")return{mobile:"image",gpuFailure:"image",providerFailure:"dom",reducedMotion:"image"};if(renderer==="image")return{mobile:"image",gpuFailure:"image",providerFailure:"dom",reducedMotion:"image"};return{mobile:"dom",gpuFailure:"dom",providerFailure:"dom",reducedMotion:"dom"};}
export function compileMediaOrchestration(page:SectionPageSource):MediaOrchestrationPlan{const decisions=page.sections.map((section,index):MediaDecision=>{const renderer=choose(page.category,section.kind);const responsive=compileResponsiveSectionPolicy(section.kind);const generated=renderer==="image"||renderer==="video";const gpu=renderer==="pixi"||renderer==="three";const criticality=section.kind==="hero"?"primary":renderer==="dom"?"supporting":section.kind.includes("stage")?"supporting":"decorative";return{sectionId:section.id,kind:section.kind,renderer,purpose:purpose(renderer,section.kind),justification:renderer==="dom"?"No rich-media value exceeds semantic DOM cost for this section.":`${renderer} matches ${section.kind} intent within responsive and accessibility budgets.`,criticality,lazyPriority:index<=1?"eager":criticality==="decorative"?"idle":"viewport",budget:{maxBytes:renderer==="video"?1_500_000:renderer==="image"?450_000:gpu?600_000:0,maxDpr:responsive.degradation.maxDprMobile,maxTriangles:renderer==="three"?2500:0,maxDrawCalls:gpu?8:0},accessibility:{semanticOwner:"DOM",altRequired:renderer==="image"||renderer==="video",descriptionRequired:gpu,canvasAriaHidden:gpu},fallback:fallback(renderer),execution:generated?{provider:"PRODUCTION_PROVIDER_REQUIRED",state:"PROVIDER_NOT_ADMITTED",provenanceRequired:true}:renderer==="dom"||gpu?{provider:"NONE",state:"NO_JOB",provenanceRequired:gpu}:{provider:"internal-deterministic-mock",state:"READY_INTERNAL",provenanceRequired:true}};});return{schema:"website-design-compiler/media-orchestration/v2",category:page.category,decisions,richMediaCount:decisions.filter((d)=>d.renderer!=="dom").length,gpuCount:decisions.filter((d)=>d.renderer==="pixi"||d.renderer==="three").length,providerBlockedCount:decisions.filter((d)=>d.execution.state==="PROVIDER_NOT_ADMITTED").length,strategySignature:decisions.map((d)=>`${d.kind}:${d.renderer}`).join("|")};}
export function validateMediaOrchestration(plan:MediaOrchestrationPlan):string[]{const errors:string[]=[];for(const decision of plan.decisions){if(decision.accessibility.semanticOwner!=="DOM")errors.push(`${decision.sectionId}: semantic ownership escaped DOM`);if((decision.renderer==="pixi"||decision.renderer==="three")&&!decision.accessibility.canvasAriaHidden)errors.push(`${decision.sectionId}: GPU canvas must be aria-hidden`);if((decision.renderer==="pixi"||decision.renderer==="three"||decision.renderer==="video")&&decision.fallback.gpuFailure===decision.renderer)errors.push(`${decision.sectionId}: accelerated media lacks lower-complexity failure fallback`);if(decision.renderer==="image"&&decision.fallback.providerFailure!=="dom")errors.push(`${decision.sectionId}: image lacks provider-failure DOM fallback`);if((decision.renderer==="image"||decision.renderer==="video")&&decision.execution.state!=="PROVIDER_NOT_ADMITTED")errors.push(`${decision.sectionId}: real generated media cannot execute before provider admission`);if(decision.renderer==="dom"&&decision.budget.maxBytes!==0)errors.push(`${decision.sectionId}: DOM-only decision carries media bytes`);}return errors;}
