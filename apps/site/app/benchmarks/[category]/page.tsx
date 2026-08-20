import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { GeneratedPage, type ProjectedPageGraph } from "@/components/sections/generated-page";
import projection from "@/generated/benchmark-page-graphs.json";

const graphs=projection.graphs as Record<string,ProjectedPageGraph>;
type ProjectedSite={project:string;signature:string;source:{mode:string;artifacts:Record<string,string>};routes:Array<{route:string;page:ProjectedPageGraph&{signature:string}}>};
type ProjectedTokens={color:{background:string;surface:string;text:string;mutedText:string;accent:string;onAccent:string;focus:string};typography:{display:{family:string;fallback:string[];weight:number;lineHeight:number;letterSpacingEm:number};body:{family:string;fallback:string[];weight:number;lineHeight:number;measureCh:number};scalePx:{mobile:number[];tablet:number[];desktop:number[]}};layout:{containerMaxPx:{mobile:number;tablet:number;desktop:number};columns:{mobile:number;tablet:number;desktop:number};gutterPx:{mobile:number;tablet:number;desktop:number}};spacingPx:number[];radiiPx:{sm:number;md:number;lg:number;pill:number};border:{widthPx:number;style:string;color:string};elevation:{low:string;high:string};motionMs:{fast:number;base:number;slow:number};media:{treatment:string;gradientPolicy:string;blurMaxPx:number;noiseOpacityMax:number};interaction:{focusRingPx:number;focusOffsetPx:number;minTargetPx:number;hoverLiftPx:number}};
type ProjectedDirection={typography:string;typeContrast:string;density:string;grid:string;surface:string;colorStrategy:string;mediaStrategy:string;motionIntensity:string;signatureInteraction:string};
type ProjectedDesignSystem={selectedVisualDirection:{candidateId:string;dimensions:ProjectedDirection}};
type TokenStyle=CSSProperties&Record<`--${string}`,string|number>;
const sites=projection.sites as Record<string,ProjectedSite>;
const designTokens=projection.designTokens as Record<string,ProjectedTokens>;
const designSystems=projection.designSystems as Record<string,ProjectedDesignSystem>;
export function generateStaticParams(){return Object.keys(graphs).map((category)=>({category}));}

function tokenStyle(tokens:ProjectedTokens):TokenStyle{
  const style:TokenStyle={
    "--wdc-color-background":tokens.color.background,"--wdc-color-surface":tokens.color.surface,"--wdc-color-text-primary":tokens.color.text,"--wdc-color-text-muted":tokens.color.mutedText,"--wdc-color-accent":tokens.color.accent,"--wdc-color-on-accent":tokens.color.onAccent,"--wdc-color-focus":tokens.color.focus,
    "--wdc-font-display":`${JSON.stringify(tokens.typography.display.family)}, ${tokens.typography.display.fallback.join(", ")}`,"--wdc-font-body":`${JSON.stringify(tokens.typography.body.family)}, ${tokens.typography.body.fallback.join(", ")}`,"--wdc-font-display-weight":tokens.typography.display.weight,"--wdc-font-display-line-height":tokens.typography.display.lineHeight,"--wdc-font-display-letter-spacing":`${tokens.typography.display.letterSpacingEm}em`,"--wdc-font-body-weight":tokens.typography.body.weight,"--wdc-font-body-line-height":tokens.typography.body.lineHeight,"--wdc-font-body-measure":`${tokens.typography.body.measureCh}ch`,
    "--wdc-radius-sm":`${tokens.radiiPx.sm}px`,"--wdc-radius-md":`${tokens.radiiPx.md}px`,"--wdc-radius-lg":`${tokens.radiiPx.lg}px`,"--wdc-radius-pill":`${tokens.radiiPx.pill}px`,"--wdc-border-width":`${tokens.border.widthPx}px`,"--wdc-border-style":tokens.border.style,"--wdc-border-color":tokens.border.color,"--wdc-elevation-low":tokens.elevation.low,"--wdc-elevation-high":tokens.elevation.high,"--wdc-motion-fast":`${tokens.motionMs.fast}ms`,"--wdc-motion-base":`${tokens.motionMs.base}ms`,"--wdc-motion-slow":`${tokens.motionMs.slow}ms`,"--wdc-media-treatment":tokens.media.treatment,"--wdc-media-gradient-policy":tokens.media.gradientPolicy,"--wdc-media-blur-max":`${tokens.media.blurMaxPx}px`,"--wdc-media-noise-opacity-max":tokens.media.noiseOpacityMax,"--wdc-focus-ring":`${tokens.interaction.focusRingPx}px`,"--wdc-focus-offset":`${tokens.interaction.focusOffsetPx}px`,"--wdc-target-min":`${tokens.interaction.minTargetPx}px`,"--wdc-hover-lift":`${tokens.interaction.hoverLiftPx}px`,
    "--wdc-container-max-mobile":`${tokens.layout.containerMaxPx.mobile}px`,"--wdc-container-max-tablet":`${tokens.layout.containerMaxPx.tablet}px`,"--wdc-container-max-desktop":`${tokens.layout.containerMaxPx.desktop}px`,"--wdc-grid-columns-mobile":tokens.layout.columns.mobile,"--wdc-grid-columns-tablet":tokens.layout.columns.tablet,"--wdc-grid-columns-desktop":tokens.layout.columns.desktop,"--wdc-gutter-mobile":`${tokens.layout.gutterPx.mobile}px`,"--wdc-gutter-tablet":`${tokens.layout.gutterPx.tablet}px`,"--wdc-gutter-desktop":`${tokens.layout.gutterPx.desktop}px`
  };
  tokens.spacingPx.forEach((value,index)=>{style[`--wdc-space-${index}`]=`${value}px`;});
  style["--wdc-space-xs"]="var(--wdc-space-1)";style["--wdc-space-sm"]="var(--wdc-space-2)";style["--wdc-space-md"]="var(--wdc-space-3)";style["--wdc-space-lg"]="var(--wdc-space-4)";style["--wdc-space-xl"]="var(--wdc-space-5)";
  for(const viewport of ["mobile","tablet","desktop"] as const)tokens.typography.scalePx[viewport].forEach((value,index)=>{style[`--wdc-type-scale-${index}-${viewport}`]=`${value}px`;});
  return style;
}

export default async function BenchmarkPage({params,searchParams}:{params:Promise<{category:string}>;searchParams:Promise<{route?:string}>}){
  const {category}=await params;
  const {route="/"}=await searchParams;
  const site=sites[category];
  const tokens=designTokens[category];
  const designSystem=designSystems[category];
  const graph=site?.routes.find((entry)=>entry.route===route)?.page;
  if(!site||!graph||!tokens||!designSystem)notFound();
  const direction=designSystem.selectedVisualDirection.dimensions;
  return <div style={tokenStyle(tokens)} data-compiled-site={category} data-site-project={site.project} data-site-route={route} data-site-signature={site.signature} data-page-signature={graph.signature} data-upstream-mode={site.source.mode} data-upstream-artifacts={JSON.stringify(site.source.artifacts)} data-direction-typography={direction.typography} data-direction-contrast={direction.typeContrast} data-direction-density={direction.density} data-direction-grid={direction.grid} data-direction-surface={direction.surface} data-direction-color={direction.colorStrategy} data-direction-media={direction.mediaStrategy} data-direction-motion={direction.motionIntensity} data-direction-interaction={direction.signatureInteraction}><GeneratedPage graph={graph}/></div>;
}
