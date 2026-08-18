import { SECTION_KINDS, type SectionKind } from "./section-grammar";
import type { SectionPageSource } from "./section-page-source.js";
import type { VisualDirectionDimensions } from "./visual-direction-search.js";

export type LayoutMode="stack"|"split"|"grid"|"inline"|"stage"|"list";
export type Density="compact"|"comfortable"|"spacious";
export interface ViewportComposition { layout:LayoutMode; columns:1|2|3|4; visualOrder:string[]; mediaPlacement:"before"|"after"|"background"|"none"; sticky:boolean; density:Density; maxContentChars:number; }
export interface ResponsiveSectionPolicy { kind:SectionKind; semanticOrder:"DOM_STABLE"; mobile:ViewportComposition; tablet:ViewportComposition; desktop:ViewportComposition; coarsePointer:{hoverRequired:false;carousel:"controls"|"static";sticky:boolean}; reducedMotion:{essentialOnly:true;transition:"instant"|"short"}; degradation:{maxDprMobile:1.5;graphics2d:"static-poster"|"progressive";graphics3d:"static-poster"|"progressive";media:"poster-first"|"normal"}; }
const INTERACTIVE=new Set<SectionKind>(["graphics-2d-stage","graphics-3d-stage","media-stage","product-showcase"]);
const GRID=new Set<SectionKind>(["feature-grid","bento-grid","proof-cloud","metrics","comparison","pricing"]);
const DENSE=new Set<SectionKind>(["navigation","footer","faq","editorial-prose"]);
function composition(kind:SectionKind,viewport:"mobile"|"tablet"|"desktop",direction?:VisualDirectionDimensions):ViewportComposition{
  const interactive=INTERACTIVE.has(kind);const grid=GRID.has(kind);const dense=DENSE.has(kind);
  const density:Density=!direction?viewport==="mobile"?"compact":viewport==="tablet"?"comfortable":"spacious":direction.density==="dense"?"compact":direction.density==="airy"?"spacious":"comfortable";
  if(viewport==="mobile"){
    const asymmetric=direction?.grid==="asymmetric";
    return{layout:interactive?"stage":grid?"stack":dense?"list":"stack",columns:1,visualOrder:asymmetric?["media","content"]:["content","media"],mediaPlacement:interactive?asymmetric?"before":"after":"none",sticky:false,density,maxContentChars:kind==="hero"?180:240};
  }
  if(!direction){if(viewport==="tablet")return{layout:interactive||kind==="hero"?"split":grid?"grid":dense?"list":"stack",columns:grid?2:interactive||kind==="hero"?2:1,visualOrder:["content","media"],mediaPlacement:interactive||kind==="hero"?"after":"none",sticky:false,density,maxContentChars:360};return{layout:interactive||kind==="hero"?"split":grid?"grid":dense?"list":"stack",columns:grid?3:interactive||kind==="hero"?2:1,visualOrder:["content","media"],mediaPlacement:interactive?"after":kind==="hero"?"background":"none",sticky:kind==="navigation",density,maxContentChars:520};}
  const editorial=direction.grid==="editorial";const asymmetric=direction.grid==="asymmetric";
  const gridColumns:1|2|3|4=viewport==="tablet"?2:direction.grid==="strict"?4:direction.grid==="modular"?3:2;
  const heroSplit=direction.mediaStrategy==="product-media"||direction.mediaStrategy==="interactive-stage";
  const layout:LayoutMode=interactive?"stage":kind==="hero"?(heroSplit?"split":"stack"):grid?(editorial?"list":"grid"):dense?"list":asymmetric?"split":"stack";
  const columns:1|2|3|4=layout==="grid"?gridColumns:layout==="split"||layout==="stage"?2:1;
  return{layout,columns,visualOrder:asymmetric?["media","content"]:["content","media"],mediaPlacement:interactive||heroSplit?"after":"none",sticky:kind==="navigation"&&viewport==="desktop",density,maxContentChars:viewport==="tablet"?360:direction.density==="dense"?420:560};
}
export function compileResponsiveSectionPolicy(kind:SectionKind,direction?:VisualDirectionDimensions):ResponsiveSectionPolicy{
  const interactive=INTERACTIVE.has(kind);
  return{kind,semanticOrder:"DOM_STABLE",mobile:composition(kind,"mobile",direction),tablet:composition(kind,"tablet",direction),desktop:composition(kind,"desktop",direction),coarsePointer:{hoverRequired:false,carousel:kind==="testimonial"?"controls":"static",sticky:false},reducedMotion:{essentialOnly:true,transition:"instant"},degradation:{maxDprMobile:1.5,graphics2d:kind==="graphics-2d-stage"?"static-poster":"progressive",graphics3d:kind==="graphics-3d-stage"?"static-poster":"progressive",media:interactive?"poster-first":"normal"}};
}
export function compileResponsiveRegistry():ResponsiveSectionPolicy[]{return SECTION_KINDS.map((kind)=>compileResponsiveSectionPolicy(kind));}
export interface ResponsivePageGraph { schema:"website-design-compiler/responsive-page-graph/v2";category:string;semanticOrder:string[];mobile:Array<{id:string;kind:SectionKind;composition:ViewportComposition}>;tablet:Array<{id:string;kind:SectionKind;composition:ViewportComposition}>;desktop:Array<{id:string;kind:SectionKind;composition:ViewportComposition}>; }
export function compileResponsivePageGraph(page:SectionPageSource):ResponsivePageGraph{
  const semanticOrder=page.sections.map((section)=>section.id);
  const map=(viewport:"mobile"|"tablet"|"desktop")=>page.sections.map((section)=>({id:section.id,kind:section.kind,composition:compileResponsiveSectionPolicy(section.kind)[viewport]}));
  return{schema:"website-design-compiler/responsive-page-graph/v2",category:page.category,semanticOrder,mobile:map("mobile"),tablet:map("tablet"),desktop:map("desktop")};
}
