import { SECTION_KINDS, type SectionKind } from "./section-grammar";
import type { SectionPageSource } from "./section-page-source.js";

export type LayoutMode="stack"|"split"|"grid"|"inline"|"stage"|"list";
export type Density="compact"|"comfortable"|"spacious";
export interface ViewportComposition { layout:LayoutMode; columns:1|2|3|4; visualOrder:string[]; mediaPlacement:"before"|"after"|"background"|"none"; sticky:boolean; density:Density; maxContentChars:number; }
export interface ResponsiveSectionPolicy { kind:SectionKind; semanticOrder:"DOM_STABLE"; mobile:ViewportComposition; tablet:ViewportComposition; desktop:ViewportComposition; coarsePointer:{hoverRequired:false;carousel:"controls"|"static";sticky:boolean}; reducedMotion:{essentialOnly:true;transition:"instant"|"short"}; degradation:{maxDprMobile:1.5;graphics2d:"static-poster"|"progressive";graphics3d:"static-poster"|"progressive";media:"poster-first"|"normal"}; }
const INTERACTIVE=new Set<SectionKind>(["graphics-2d-stage","graphics-3d-stage","media-stage","product-showcase"]);
const GRID=new Set<SectionKind>(["feature-grid","bento-grid","proof-cloud","metrics","comparison","pricing"]);
const DENSE=new Set<SectionKind>(["navigation","footer","faq","editorial-prose"]);
function composition(kind:SectionKind,viewport:"mobile"|"tablet"|"desktop"):ViewportComposition{
  const interactive=INTERACTIVE.has(kind);const grid=GRID.has(kind);const dense=DENSE.has(kind);
  if(viewport==="mobile")return{layout:interactive?"stage":grid?"stack":dense?"list":"stack",columns:1,visualOrder:["content","media"],mediaPlacement:interactive?"after":"none",sticky:false,density:"compact",maxContentChars:kind==="hero"?180:240};
  if(viewport==="tablet")return{layout:interactive||kind==="hero"?"split":grid?"grid":dense?"list":"stack",columns:grid?2:interactive||kind==="hero"?2:1,visualOrder:["content","media"],mediaPlacement:interactive||kind==="hero"?"after":"none",sticky:false,density:"comfortable",maxContentChars:360};
  return{layout:interactive||kind==="hero"?"split":grid?"grid":dense?"list":"stack",columns:grid?3:interactive||kind==="hero"?2:1,visualOrder:["content","media"],mediaPlacement:interactive?"after":kind==="hero"?"background":"none",sticky:kind==="navigation",density:"spacious",maxContentChars:520};
}
export function compileResponsiveSectionPolicy(kind:SectionKind):ResponsiveSectionPolicy{
  const interactive=INTERACTIVE.has(kind);
  return{kind,semanticOrder:"DOM_STABLE",mobile:composition(kind,"mobile"),tablet:composition(kind,"tablet"),desktop:composition(kind,"desktop"),coarsePointer:{hoverRequired:false,carousel:kind==="testimonial"?"controls":"static",sticky:false},reducedMotion:{essentialOnly:true,transition:"instant"},degradation:{maxDprMobile:1.5,graphics2d:kind==="graphics-2d-stage"?"static-poster":"progressive",graphics3d:kind==="graphics-3d-stage"?"static-poster":"progressive",media:interactive?"poster-first":"normal"}};
}
export function compileResponsiveRegistry():ResponsiveSectionPolicy[]{return SECTION_KINDS.map(compileResponsiveSectionPolicy);}
export interface ResponsivePageGraph { schema:"website-design-compiler/responsive-page-graph/v2";category:string;semanticOrder:string[];mobile:Array<{id:string;kind:SectionKind;composition:ViewportComposition}>;tablet:Array<{id:string;kind:SectionKind;composition:ViewportComposition}>;desktop:Array<{id:string;kind:SectionKind;composition:ViewportComposition}>; }
export function compileResponsivePageGraph(page:SectionPageSource):ResponsivePageGraph{
  const semanticOrder=page.sections.map((section)=>section.id);
  const map=(viewport:"mobile"|"tablet"|"desktop")=>page.sections.map((section)=>({id:section.id,kind:section.kind,composition:compileResponsiveSectionPolicy(section.kind)[viewport]}));
  return{schema:"website-design-compiler/responsive-page-graph/v2",category:page.category,semanticOrder,mobile:map("mobile"),tablet:map("tablet"),desktop:map("desktop")};
}
