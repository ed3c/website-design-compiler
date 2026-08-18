import type { SectionKind } from "./section-grammar";
import type { SectionPageFixture } from "./section-page-fixtures";
import { compileResponsiveSectionPolicy } from "./responsive-composition";

export type MotionPurpose="orient"|"reveal-causality"|"confirm-action"|"spatial-continuity"|"emphasize-hierarchy"|"express-brand";
export type MotionEngine="motion"|"gsap"|"none";
export interface ChoreographyEffect { id:string; sectionId:string; kind:SectionKind; purpose:MotionPurpose; target:"section"|"content"|"media"|"interaction"; trigger:"enter"|"interaction"|"scroll-progress"|"route-change"; engine:MotionEngine; durationMs:number; delayMs:number; easing:string; interruption:"cancel-and-settle"|"resume-safe"; mobile:"full"|"simplified"|"disabled"; reducedMotion:"instant"|"disabled"; blocksPrimaryInteraction:false; layoutProperties:false; fallback:"static-visible"|"instant-state"; cleanup:"on-unmount-and-route-change"; }
export interface MotionChoreographyPlan { schema:"website-design-compiler/motion-choreography/v2"; category:string; effects:ChoreographyEffect[]; budget:{maxConcurrent:3;maxEffectMs:700;maxTotalMs:number;layoutPropertiesAllowed:false}; totalDurationMs:number; scrollLinkedCount:number; engineRouting:{motion:number;gsap:number;none:number}; }

function purposeFor(kind:SectionKind):MotionPurpose{
  if(kind==="navigation"||kind==="footer")return"orient";
  if(kind==="hero")return"emphasize-hierarchy";
  if(kind==="graphics-2d-stage"||kind==="graphics-3d-stage"||kind==="media-stage")return"spatial-continuity";
  if(kind==="cta")return"confirm-action";
  if(kind==="bento-grid"||kind==="product-showcase")return"express-brand";
  return"reveal-causality";
}
function isScrollLinked(kind:SectionKind):boolean{return kind==="editorial-prose"||kind==="graphics-2d-stage"||kind==="graphics-3d-stage"||kind==="product-showcase";}
function isStaticByDesign(kind:SectionKind):boolean{return kind==="navigation"||kind==="footer"||kind==="faq"||kind==="proof-cloud";}
export function compileMotionChoreography(page:SectionPageFixture):MotionChoreographyPlan{
  const effects:ChoreographyEffect[]=page.sections.map((section,index)=>{
    const responsive=compileResponsiveSectionPolicy(section.kind);
    const scroll=isScrollLinked(section.kind);
    const staticByDesign=isStaticByDesign(section.kind);
    const gpu=section.kind==="graphics-2d-stage"||section.kind==="graphics-3d-stage";
    const durationMs=staticByDesign?0:gpu?520:section.kind==="hero"?420:280;
    return{id:`motion-${section.id}`,sectionId:section.id,kind:section.kind,purpose:purposeFor(section.kind),target:gpu?"media":"section",trigger:scroll?"scroll-progress":"enter",engine:staticByDesign?"none":scroll?"gsap":"motion",durationMs,delayMs:staticByDesign?0:Math.min(index*30,150),easing:scroll?"linear":"cubic-bezier(0.22,1,0.36,1)",interruption:scroll?"resume-safe":"cancel-and-settle",mobile:responsive.mobile.layout==="stage"?"simplified":"full",reducedMotion:scroll?"disabled":"instant",blocksPrimaryInteraction:false,layoutProperties:false,fallback:"static-visible",cleanup:"on-unmount-and-route-change"};
  });
  const totalDurationMs=effects.reduce((sum,effect)=>sum+effect.durationMs+effect.delayMs,0);
  const engineRouting={motion:effects.filter((e)=>e.engine==="motion").length,gsap:effects.filter((e)=>e.engine==="gsap").length,none:effects.filter((e)=>e.engine==="none").length};
  return{schema:"website-design-compiler/motion-choreography/v2",category:page.category,effects,budget:{maxConcurrent:3,maxEffectMs:700,maxTotalMs:Math.max(4000,effects.length*900),layoutPropertiesAllowed:false},totalDurationMs,scrollLinkedCount:effects.filter((e)=>e.trigger==="scroll-progress").length,engineRouting};
}
export function validateMotionChoreography(plan:MotionChoreographyPlan):string[]{
  const errors:string[]=[];
  if(plan.effects.some((e)=>e.blocksPrimaryInteraction))errors.push("motion blocks primary interaction");
  if(plan.effects.some((e)=>e.layoutProperties))errors.push("layout-triggering motion property forbidden");
  if(plan.effects.some((e)=>e.durationMs>plan.budget.maxEffectMs))errors.push("effect exceeds duration budget");
  if(plan.effects.some((e)=>e.engine==="none"&&(e.durationMs!==0||e.delayMs!==0)))errors.push("static effect carries animation timing");
  if(plan.totalDurationMs>plan.budget.maxTotalMs)errors.push("total choreography exceeds budget");
  if(plan.effects.some((e)=>e.trigger==="scroll-progress"&&e.reducedMotion!=="disabled"))errors.push("scroll-linked effect lacks reduced-motion fallback");
  if(plan.effects.some((e)=>e.cleanup!=="on-unmount-and-route-change"))errors.push("effect lacks lifecycle cleanup policy");
  return errors;
}
