import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { searchVisualDirections } from "./visual-direction-search.js";

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
  { background: "oklch(0.985 0.006 250)", surface: "oklch(0.955 0.012 250)", text: "oklch(0.22 0.025 250)", mutedText: "oklch(0.43 0.025 250)", accent: "oklch(0.58 0.19 255)", focus: "oklch(0.62 0.20 255)" },
  { background: "oklch(0.98 0.012 80)", surface: "oklch(0.94 0.022 80)", text: "oklch(0.23 0.025 65)", mutedText: "oklch(0.44 0.035 65)", accent: "oklch(0.60 0.16 45)", focus: "oklch(0.57 0.18 45)" },
  { background: "oklch(0.975 0.008 155)", surface: "oklch(0.94 0.018 155)", text: "oklch(0.21 0.025 155)", mutedText: "oklch(0.42 0.035 155)", accent: "oklch(0.55 0.15 155)", focus: "oklch(0.58 0.17 155)" }
] as const;

function stableIndex(value: string, modulo: number): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % modulo;
}

export function compileSemanticDesignTokens(input: CompilerInput): SemanticDesignTokensV2 {
  const visual = searchVisualDirections(input);
  const selected = visual.selectedDirection;
  const palette = PALETTES[stableIndex(`${input.brief.pageType}:${selected.colorStrategy}`, PALETTES.length)];
  const editorial = selected.density === "airy";
  const displayFamily = selected.typographyFamily === "editorial-serif" ? "Georgia" : selected.typographyFamily === "geometric-sans" ? "Avenir Next" : "Inter";
  return {
    schema: "website-design-compiler/semantic-design-tokens/v2",
    project: input.project,
    sourceVisualDirection: visual.selectedCandidateId,
    color: { mode: "light", ...palette, contrastPolicy: "WCAG_AA_TEXT" },
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
    radiiPx: selected.surfaceTreatment === "soft" ? { sm: 8, md: 16, lg: 28, pill: 999 } : { sm: 4, md: 8, lg: 16, pill: 999 },
    border: { widthPx: 1, style: "solid", color: palette.surface },
    elevation: { low: "0 1px 3px rgb(0 0 0 / 0.08)", high: "0 18px 48px rgb(0 0 0 / 0.14)" },
    motionMs: selected.motionIntensity === "high" ? { fast: 100, base: 220, slow: 520 } : selected.motionIntensity === "low" ? { fast: 120, base: 180, slow: 280 } : { fast: 110, base: 200, slow: 380 },
    media: { treatment: selected.mediaStrategy, gradientPolicy: selected.colorStrategy, blurMaxPx: 24, noiseOpacityMax: 0.06 },
    interaction: { focusRingPx: 3, focusOffsetPx: 2, rawValueBypass: false }
  };
}

export function projectSemanticTokensToCss(tokens: SemanticDesignTokensV2): string {
  return [":root {", `  --color-background: ${tokens.color.background};`, `  --color-surface: ${tokens.color.surface};`, `  --color-text: ${tokens.color.text};`, `  --color-muted-text: ${tokens.color.mutedText};`, `  --color-accent: ${tokens.color.accent};`, `  --color-focus: ${tokens.color.focus};`, `  --font-display: ${JSON.stringify(tokens.typography.display.family)};`, `  --font-body: ${JSON.stringify(tokens.typography.body.family)};`, `  --container-desktop: ${tokens.layout.containerMaxPx.desktop}px;`, `  --gutter-mobile: ${tokens.layout.gutterPx.mobile}px;`, `  --radius-md: ${tokens.radiiPx.md}px;`, `  --motion-base: ${tokens.motionMs.base}ms;`, "}", ""].join("\n");
}

export async function writeSemanticDesignTokens(input: CompilerInput, outputDirectory: string): Promise<string[]> {
  const tokens = compileSemanticDesignTokens(input);
  const directory = join(outputDirectory, "semantic-design-tokens");
  await mkdir(directory, { recursive: true });
  const jsonPath = join(directory, "semantic-design-tokens.json");
  const cssPath = join(directory, "semantic-design-tokens.css");
  await writeFile(jsonPath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
  await writeFile(cssPath, projectSemanticTokensToCss(tokens), "utf8");
  return [jsonPath, cssPath];
}
