import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { searchVisualDirections } from "./visual-direction-search.js";
import { validateAgainstSchema } from "./validate.js";

export interface SemanticDesignTokensV2 {
  schema: "website-design-compiler/semantic-design-tokens/v2";
  project: string;
  sourceVisualDirection: string;
  color: {
    mode: "light";
    background: string;
    surface: string;
    text: string;
    mutedText: string;
    accent: string;
    focus: string;
    contrastPolicy: "WCAG_AA_TEXT";
    contrastEvidence: { textOnBackground: number; mutedTextOnBackground: number; focusOnBackground: number; minimumText: 4.5; minimumFocus: 3 };
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

const PALETTES = [
  { background: "oklch(0.985 0.006 250)", surface: "oklch(0.955 0.012 250)", text: "oklch(0.22 0.025 250)", mutedText: "oklch(0.43 0.025 250)", accent: "oklch(0.58 0.19 255)", focus: "oklch(0.50 0.20 255)" },
  { background: "oklch(0.98 0.012 80)", surface: "oklch(0.94 0.022 80)", text: "oklch(0.23 0.025 65)", mutedText: "oklch(0.43 0.035 65)", accent: "oklch(0.57 0.16 45)", focus: "oklch(0.48 0.18 45)" },
  { background: "oklch(0.975 0.008 155)", surface: "oklch(0.94 0.018 155)", text: "oklch(0.21 0.025 155)", mutedText: "oklch(0.42 0.035 155)", accent: "oklch(0.54 0.15 155)", focus: "oklch(0.47 0.17 155)" }
] as const;

function stableIndex(value: string, modulo: number): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % modulo;
}

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

export function compileSemanticDesignTokens(input: CompilerInput): SemanticDesignTokensV2 {
  const visual = searchVisualDirections(input);
  const selected = visual.selectedDirection;
  const palette = PALETTES[stableIndex(`${input.brief.pageType}:${selected.colorStrategy}`, PALETTES.length)]!;
  const editorial = selected.density === "airy";
  const displayFamily = selected.typography === "editorial-serif" ? "Georgia" : selected.typography === "display-contrast" ? "Arial Black" : "Inter";
  const textOnBackground = contrastRatio(palette.text, palette.background);
  const mutedTextOnBackground = contrastRatio(palette.mutedText, palette.background);
  const focusOnBackground = contrastRatio(palette.focus, palette.background);
  if (textOnBackground < 4.5 || mutedTextOnBackground < 4.5 || focusOnBackground < 3) throw new Error("semantic token palette fails configured contrast policy");
  return {
    schema: "website-design-compiler/semantic-design-tokens/v2",
    project: input.project,
    sourceVisualDirection: visual.selectedCandidateId,
    color: { mode: "light", ...palette, contrastPolicy: "WCAG_AA_TEXT", contrastEvidence: { textOnBackground, mutedTextOnBackground, focusOnBackground, minimumText: 4.5, minimumFocus: 3 } },
    typography: {
      display: { family: displayFamily, fallback: ["system-ui", "sans-serif"], weight: selected.typeContrast === "dramatic" ? 700 : 600, lineHeight: 1.08, letterSpacingEm: -0.025 },
      body: { family: "Inter", fallback: ["system-ui", "sans-serif"], weight: 400, lineHeight: editorial ? 1.7 : 1.55, measureCh: editorial ? 68 : 62 },
      scalePx: { mobile: [12, 14, 16, 20, 28, 40], tablet: [12, 14, 16, 22, 34, 52], desktop: [12, 14, 17, 24, 40, 64] }
    },
    layout: {
      breakpointsPx: { mobile: 0, tablet: 768, desktop: 1200 },
      containerMaxPx: { mobile: 560, tablet: selected.grid === "editorial" ? 880 : 960, desktop: selected.grid === "asymmetric" ? 1360 : 1200 },
      columns: { mobile: 4, tablet: selected.grid === "editorial" ? 8 : 10, desktop: 12 },
      gutterPx: { mobile: 16, tablet: editorial ? 28 : 24, desktop: editorial ? 40 : 32 }
    },
    spacingPx: editorial ? [4, 8, 16, 28, 44, 72, 112] : [4, 8, 12, 20, 32, 52, 84],
    radiiPx: selected.surface === "layered" ? { sm: 8, md: 16, lg: 28, pill: 999 } : { sm: 4, md: 8, lg: 16, pill: 999 },
    border: { widthPx: 1, style: "solid", color: palette.surface },
    elevation: { low: "0 1px 3px rgb(0 0 0 / 0.08)", high: "0 18px 48px rgb(0 0 0 / 0.14)" },
    motionMs: selected.motionIntensity === "expressive" ? { fast: 100, base: 220, slow: 520 } : selected.motionIntensity === "minimal" ? { fast: 120, base: 180, slow: 280 } : { fast: 110, base: 200, slow: 380 },
    media: { treatment: selected.mediaStrategy, gradientPolicy: selected.colorStrategy, blurMaxPx: 24, noiseOpacityMax: 0.06 },
    interaction: { focusRingPx: 3, focusOffsetPx: 2, rawValueBypass: false }
  };
}

export function projectSemanticTokensToCss(tokens: SemanticDesignTokensV2): string {
  const s = tokens.spacingPx;
  return [
    ":root {",
    `  --wdc-color-background: ${tokens.color.background};`, `  --wdc-color-surface: ${tokens.color.surface};`, `  --wdc-color-text-primary: ${tokens.color.text};`, `  --wdc-color-text-muted: ${tokens.color.mutedText};`, `  --wdc-color-accent: ${tokens.color.accent};`, `  --wdc-color-focus: ${tokens.color.focus};`,
    `  --wdc-font-display: ${JSON.stringify(tokens.typography.display.family)}, ${tokens.typography.display.fallback.join(", ")};`, `  --wdc-font-body: ${JSON.stringify(tokens.typography.body.family)}, ${tokens.typography.body.fallback.join(", ")};`,
    `  --wdc-space-xs: ${s[1]}px;`, `  --wdc-space-sm: ${s[2]}px;`, `  --wdc-space-md: ${s[3]}px;`, `  --wdc-space-lg: ${s[4]}px;`, `  --wdc-space-xl: ${s[5]}px;`,
    `  --wdc-radius-md: ${tokens.radiiPx.md}px;`, `  --wdc-radius-lg: ${tokens.radiiPx.lg}px;`, `  --wdc-motion-fast: ${tokens.motionMs.fast}ms;`, `  --wdc-motion-base: ${tokens.motionMs.base}ms;`,
    `  --wdc-container-max: ${tokens.layout.containerMaxPx.desktop}px;`, `  --wdc-grid-columns: ${tokens.layout.columns.desktop};`, `  --wdc-gutter: ${tokens.layout.gutterPx.desktop}px;`, "}",
    `@media (max-width: 1199px) { :root { --wdc-container-max: ${tokens.layout.containerMaxPx.tablet}px; --wdc-grid-columns: ${tokens.layout.columns.tablet}; --wdc-gutter: ${tokens.layout.gutterPx.tablet}px; } }`,
    `@media (max-width: 767px) { :root { --wdc-container-max: ${tokens.layout.containerMaxPx.mobile}px; --wdc-grid-columns: ${tokens.layout.columns.mobile}; --wdc-gutter: ${tokens.layout.gutterPx.mobile}px; } }`,
    ""
  ].join("\n");
}

export async function writeSemanticDesignTokens(input: CompilerInput, outputDirectory: string): Promise<string[]> {
  const tokens = compileSemanticDesignTokens(input);
  await validateAgainstSchema(tokens, "semantic-design-tokens-v2.schema.json");
  const directory = join(outputDirectory, "semantic-design-tokens");
  await mkdir(directory, { recursive: true });
  const jsonPath = join(directory, "semantic-design-tokens.json");
  const cssPath = join(directory, "semantic-design-tokens.css");
  await writeFile(jsonPath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
  await writeFile(cssPath, projectSemanticTokensToCss(tokens), "utf8");
  return [jsonPath, cssPath];
}
