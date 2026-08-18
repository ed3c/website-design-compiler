import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { visualDirectionSha256, type VisualDirectionSearchReceipt } from "./visual-direction-search.js";
import { validateAgainstSchema } from "./validate.js";

export interface SemanticDesignTokensV2 {
  schema: "website-design-compiler/semantic-design-tokens/v2";
  project: string;
  sourceVisualDirection: string;
  sourceVisualDirectionReceiptSha256:string;
  color: {
    mode: "light" | "dark";
    background: string;
    surface: string;
    text: string;
    mutedText: string;
    accent: string;
    onAccent: string;
    focus: string;
    contrastPolicy: "WCAG_AA_TEXT";
    contrastEvidence: { textOnBackground: number; mutedTextOnBackground: number; onAccentOnAccent: number; focusOnBackground: number; minimumText: 4.5; minimumFocus: 3 };
  };
  typography: {
    display: { family: string; fallback: string[]; weight: number; lineHeight: number; letterSpacingEm: number };
    body: { family: string; fallback: string[]; weight: number; lineHeight: number; measureCh: number };
    scalePx: { mobile: number[]; tablet: number[]; desktop: number[] };
  };
  layout: {
    breakpointsPx: { mobile: 0; tablet: 768; desktop: 1200 };
    containerMaxPx: { mobile: number; tablet: number; desktop: number };
    columns: { mobile: number; tablet: number; desktop: number };
    gutterPx: { mobile: number; tablet: number; desktop: number };
  };
  spacingPx: number[];
  radiiPx: { sm: number; md: number; lg: number; pill: 999 };
  border: { widthPx: 1; style: "solid"; color: string };
  elevation: { low: string; high: string };
  motionMs: { fast: number; base: number; slow: number };
  media: { treatment: string; gradientPolicy: string; blurMaxPx: number; noiseOpacityMax: number };
  interaction: { focusRingPx: 3; focusOffsetPx: 2; rawValueBypass: false };
}

type Palette={mode:"light"|"dark";background:string;surface:string;text:string;mutedText:string;accent:string;focus:string};
const PALETTES:Readonly<Record<VisualDirectionSearchReceipt["selectedDirection"]["colorStrategy"],Palette>>={
  "neutral-accent":{mode:"light",background:"oklch(0.985 0.006 250)",surface:"oklch(0.955 0.012 250)",text:"oklch(0.22 0.025 250)",mutedText:"oklch(0.43 0.025 250)",accent:"oklch(0.42 0.18 255)",focus:"oklch(0.50 0.20 255)"},
  "warm-editorial":{mode:"light",background:"oklch(0.98 0.012 80)",surface:"oklch(0.94 0.022 80)",text:"oklch(0.23 0.025 65)",mutedText:"oklch(0.43 0.035 65)",accent:"oklch(0.43 0.16 45)",focus:"oklch(0.48 0.18 45)"},
  "tonal-brand":{mode:"light",background:"oklch(0.975 0.008 155)",surface:"oklch(0.91 0.035 155)",text:"oklch(0.21 0.025 155)",mutedText:"oklch(0.40 0.035 155)",accent:"oklch(0.38 0.15 155)",focus:"oklch(0.45 0.17 155)"},
  "high-contrast":{mode:"light",background:"oklch(0.975 0.015 305)",surface:"oklch(0.89 0.055 305)",text:"oklch(0.17 0.035 305)",mutedText:"oklch(0.38 0.045 305)",accent:"oklch(0.34 0.20 310)",focus:"oklch(0.44 0.19 310)"},
  "spatial-dark":{mode:"dark",background:"oklch(0.16 0.03 260)",surface:"oklch(0.24 0.05 255)",text:"oklch(0.95 0.015 220)",mutedText:"oklch(0.75 0.035 225)",accent:"oklch(0.78 0.16 205)",focus:"oklch(0.82 0.16 90)"}
};

function parseOklch(value: string): { l: number; c: number; h: number } {
  const match = /^oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)$/.exec(value);
  if (!match) throw new Error(`unsupported color token: ${value}`);
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

function relativeLuminance(value: string): number {
  const { l: L, c, h } = parseOklch(value);
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const lp = L + 0.3963377774 * a + 0.2158037573 * b;
  const mp = L - 0.1055613458 * a - 0.0638541728 * b;
  const sp = L - 0.0894841775 * a - 1.291485548 * b;
  const ll = lp ** 3;
  const mm = mp ** 3;
  const ss = sp ** 3;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const r = clamp(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss);
  const g = clamp(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss);
  const blue = clamp(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss);
  return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const high = Math.max(first, second);
  const low = Math.min(first, second);
  return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
}

export function compileSemanticDesignTokens(input: CompilerInput,visual:VisualDirectionSearchReceipt): SemanticDesignTokensV2 {
  if(visual.project!==input.project||visual.inputSha256!==visualDirectionSha256(input))throw new Error("semantic tokens require the exact visual-direction receipt for this compiler input");
  const selectedCandidate=visual.candidates.find((candidate)=>candidate.id===visual.selectedCandidateId&&candidate.state==="SELECTED");
  if(!selectedCandidate||JSON.stringify(selectedCandidate.dimensions)!==JSON.stringify(visual.selectedDirection))throw new Error("visual-direction selected candidate identity drift");
  const selected = visual.selectedDirection;
  const palette = PALETTES[selected.colorStrategy];
  const editorial = selected.grid === "editorial";
  const displayFamily = selected.typography === "editorial-serif" ? "Georgia" : selected.typography === "display-contrast" ? "Arial Black" : selected.typography==="humanist-sans"?"Trebuchet MS":"Inter";
  const bodyFamily=selected.typography==="editorial-serif"?"Georgia":selected.typography==="humanist-sans"?"Trebuchet MS":"Inter";
  const scalePx=selected.typeContrast==="dramatic"?{mobile:[12,14,16,22,32,48],tablet:[12,14,17,26,40,62],desktop:[12,15,18,30,48,76]}:selected.typeContrast==="restrained"?{mobile:[12,14,16,19,25,34],tablet:[12,14,16,20,29,40],desktop:[12,14,16,22,32,48]}:{mobile:[12,14,16,20,28,40],tablet:[12,14,16,22,34,52],desktop:[12,14,17,24,40,64]};
  const spacingPx=selected.density==="airy"?[4,10,18,30,48,80,128]:selected.density==="dense"?[4,6,10,16,24,36,56]:[4,8,12,20,32,52,84];
  const radiiPx:SemanticDesignTokensV2["radiiPx"]=selected.surface==="flat"?{sm:0,md:0,lg:0,pill:999}:selected.surface==="bordered"?{sm:2,md:4,lg:8,pill:999}:selected.surface==="tonal"?{sm:6,md:12,lg:20,pill:999}:{sm:8,md:16,lg:28,pill:999};
  const elevation=selected.surface==="layered"?{low:"0 4px 18px rgb(0 0 0 / 0.09)",high:"0 28px 72px rgb(0 0 0 / 0.16)"}:selected.surface==="bordered"?{low:"0 1px 0 rgb(0 0 0 / 0.08)",high:"0 8px 24px rgb(0 0 0 / 0.10)"}:{low:"none",high:"none"};
  const onAccent = palette.background;
  const textOnBackground = contrastRatio(palette.text, palette.background);
  const mutedTextOnBackground = contrastRatio(palette.mutedText, palette.background);
  const onAccentOnAccent = contrastRatio(onAccent, palette.accent);
  const focusOnBackground = contrastRatio(palette.focus, palette.background);
  if (textOnBackground < 4.5 || mutedTextOnBackground < 4.5 || onAccentOnAccent < 4.5 || focusOnBackground < 3) throw new Error("semantic token palette fails configured contrast policy");
  return {
    schema: "website-design-compiler/semantic-design-tokens/v2",
    project: input.project,
    sourceVisualDirection: visual.selectedCandidateId,
    sourceVisualDirectionReceiptSha256:visualDirectionSha256(visual),
    color: { ...palette, onAccent, contrastPolicy: "WCAG_AA_TEXT", contrastEvidence: { textOnBackground, mutedTextOnBackground, onAccentOnAccent, focusOnBackground, minimumText: 4.5, minimumFocus: 3 } },
    typography: {
      display: { family: displayFamily, fallback: ["system-ui", "sans-serif"], weight: selected.typeContrast === "dramatic" ? 700 : 600, lineHeight: 1.08, letterSpacingEm: -0.025 },
      body: { family: bodyFamily, fallback: ["system-ui", "sans-serif"], weight: 400, lineHeight: editorial ? 1.75 : selected.density==="dense"?1.45:1.58, measureCh: editorial ? 66 : selected.grid==="asymmetric"?58:62 },
      scalePx
    },
    layout: {
      breakpointsPx: { mobile: 0, tablet: 768, desktop: 1200 },
      containerMaxPx: { mobile: 560, tablet: selected.grid === "editorial" ? 880 : 960, desktop: selected.grid === "asymmetric" ? 1360 : 1200 },
      columns: { mobile: 4, tablet: selected.grid === "editorial" ? 8 : 10, desktop: 12 },
      gutterPx: { mobile: 16, tablet: editorial ? 28 : 24, desktop: editorial ? 40 : 32 }
    },
    spacingPx,
    radiiPx,
    border: { widthPx: 1, style: "solid", color: palette.surface },
    elevation,
    motionMs: selected.motionIntensity === "expressive" ? { fast: 100, base: 220, slow: 520 } : selected.motionIntensity === "minimal" ? { fast: 120, base: 180, slow: 280 } : { fast: 110, base: 200, slow: 380 },
    media: { treatment: selected.mediaStrategy, gradientPolicy: selected.colorStrategy, blurMaxPx: 24, noiseOpacityMax: 0.06 },
    interaction: { focusRingPx: 3, focusOffsetPx: 2, rawValueBypass: false }
  };
}

export function projectSemanticTokensToCss(tokens: SemanticDesignTokensV2): string {
  const s = tokens.spacingPx;
  const scale=(values:number[])=>values.map((value,index)=>`--wdc-type-scale-${index}: ${value}px;`).join(" ");
  return [
    ":root {",
    `  --wdc-color-background: ${tokens.color.background};`, `  --wdc-color-surface: ${tokens.color.surface};`, `  --wdc-color-text-primary: ${tokens.color.text};`, `  --wdc-color-text-muted: ${tokens.color.mutedText};`, `  --wdc-color-accent: ${tokens.color.accent};`, `  --wdc-color-on-accent: ${tokens.color.onAccent};`, `  --wdc-color-focus: ${tokens.color.focus};`,
    `  --wdc-color-contrast-policy: ${tokens.color.contrastPolicy};`, `  --wdc-contrast-text-background: ${tokens.color.contrastEvidence.textOnBackground};`, `  --wdc-contrast-muted-background: ${tokens.color.contrastEvidence.mutedTextOnBackground};`, `  --wdc-contrast-on-accent: ${tokens.color.contrastEvidence.onAccentOnAccent};`, `  --wdc-contrast-focus-background: ${tokens.color.contrastEvidence.focusOnBackground};`,
    `  --wdc-font-display: ${JSON.stringify(tokens.typography.display.family)}, ${tokens.typography.display.fallback.join(", ")};`, `  --wdc-font-body: ${JSON.stringify(tokens.typography.body.family)}, ${tokens.typography.body.fallback.join(", ")};`,
    `  --wdc-font-display-weight: ${tokens.typography.display.weight};`, `  --wdc-font-display-line-height: ${tokens.typography.display.lineHeight};`, `  --wdc-font-display-letter-spacing: ${tokens.typography.display.letterSpacingEm}em;`,
    `  --wdc-font-body-weight: ${tokens.typography.body.weight};`, `  --wdc-font-body-line-height: ${tokens.typography.body.lineHeight};`, `  --wdc-font-body-measure: ${tokens.typography.body.measureCh}ch;`,
    `  ${scale(tokens.typography.scalePx.desktop)}`,
    ...s.map((value,index)=>`  --wdc-space-${index}: ${value}px;`),
    `  --wdc-space-xs: var(--wdc-space-1);`, `  --wdc-space-sm: var(--wdc-space-2);`, `  --wdc-space-md: var(--wdc-space-3);`, `  --wdc-space-lg: var(--wdc-space-4);`, `  --wdc-space-xl: var(--wdc-space-5);`,
    `  --wdc-radius-sm: ${tokens.radiiPx.sm}px;`, `  --wdc-radius-md: ${tokens.radiiPx.md}px;`, `  --wdc-radius-lg: ${tokens.radiiPx.lg}px;`, `  --wdc-radius-pill: ${tokens.radiiPx.pill}px;`,
    `  --wdc-border-width: ${tokens.border.widthPx}px;`, `  --wdc-border-style: ${tokens.border.style};`, `  --wdc-border-color: ${tokens.border.color};`,
    `  --wdc-elevation-low: ${tokens.elevation.low};`, `  --wdc-elevation-high: ${tokens.elevation.high};`,
    `  --wdc-motion-fast: ${tokens.motionMs.fast}ms;`, `  --wdc-motion-base: ${tokens.motionMs.base}ms;`, `  --wdc-motion-slow: ${tokens.motionMs.slow}ms;`,
    `  --wdc-media-treatment: ${tokens.media.treatment};`, `  --wdc-media-gradient-policy: ${tokens.media.gradientPolicy};`, `  --wdc-media-blur-max: ${tokens.media.blurMaxPx}px;`, `  --wdc-media-noise-opacity-max: ${tokens.media.noiseOpacityMax};`,
    `  --wdc-focus-ring: ${tokens.interaction.focusRingPx}px;`, `  --wdc-focus-offset: ${tokens.interaction.focusOffsetPx}px;`, `  --wdc-raw-value-bypass: 0;`,
    `  --wdc-breakpoint-mobile: ${tokens.layout.breakpointsPx.mobile}px;`, `  --wdc-breakpoint-tablet: ${tokens.layout.breakpointsPx.tablet}px;`, `  --wdc-breakpoint-desktop: ${tokens.layout.breakpointsPx.desktop}px;`,
    `  --wdc-container-max: ${tokens.layout.containerMaxPx.desktop}px;`, `  --wdc-grid-columns: ${tokens.layout.columns.desktop};`, `  --wdc-gutter: ${tokens.layout.gutterPx.desktop}px;`, "}",
    `@media (max-width: 1199px) { :root { --wdc-container-max: ${tokens.layout.containerMaxPx.tablet}px; --wdc-grid-columns: ${tokens.layout.columns.tablet}; --wdc-gutter: ${tokens.layout.gutterPx.tablet}px; ${scale(tokens.typography.scalePx.tablet)} } }`,
    `@media (max-width: 767px) { :root { --wdc-container-max: ${tokens.layout.containerMaxPx.mobile}px; --wdc-grid-columns: ${tokens.layout.columns.mobile}; --wdc-gutter: ${tokens.layout.gutterPx.mobile}px; ${scale(tokens.typography.scalePx.mobile)} } }`,
    ""
  ].join("\n");
}

export async function writeSemanticDesignTokens(input: CompilerInput,visual:VisualDirectionSearchReceipt, outputDirectory: string): Promise<string[]> {
  const tokens = compileSemanticDesignTokens(input,visual);
  await validateAgainstSchema(tokens, "semantic-design-tokens-v2.schema.json");
  const directory = join(outputDirectory, "semantic-design-tokens");
  await mkdir(directory, { recursive: true });
  const jsonPath = join(directory, "semantic-design-tokens.json");
  const cssPath = join(directory, "semantic-design-tokens.css");
  await writeFile(jsonPath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
  await writeFile(cssPath, projectSemanticTokensToCss(tokens), "utf8");
  return [jsonPath, cssPath];
}
