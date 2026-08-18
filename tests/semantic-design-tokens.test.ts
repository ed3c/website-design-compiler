import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CompilerInput } from "../src/contracts.js";
import { compileSemanticDesignTokens, contrastRatio, projectSemanticTokensToCss } from "../src/semantic-design-tokens.js";
import { searchVisualDirections } from "../src/visual-direction-search.js";
import { validateAgainstSchema } from "../src/validate.js";

function input(pageType: string): CompilerInput {
  return { schema: "website-design-compiler/input/v1", project: `tokens-${pageType}`, brief: { pageType, audience: "design teams", objective: "compile a governed premium website" }, requestedStages: ["visual-direction-search", "semantic-design-tokens"] };
}

function compileTokens(compilerInput: CompilerInput, seed = "website-design-compiler/v2") {
  const visualSearch = searchVisualDirections(compilerInput, seed);
  return compileSemanticDesignTokens(compilerInput, visualSearch);
}

test("semantic tokens emit concrete OKLCH values with executable component contrast evidence", () => {
  const tokens = compileTokens(input("b2b-product"));
  assert.match(tokens.color.background, /^oklch\(/);
  assert.ok(tokens.color.contrastEvidence.textOnBackground >= 4.5);
  assert.ok(tokens.color.contrastEvidence.mutedTextOnBackground >= 4.5);
  assert.ok(tokens.color.contrastEvidence.onAccentOnAccent >= 4.5);
  assert.ok(tokens.color.contrastEvidence.focusOnBackground >= 3);
  assert.equal(tokens.color.contrastEvidence.textOnBackground, contrastRatio(tokens.color.text, tokens.color.background));
  assert.equal(tokens.color.contrastEvidence.onAccentOnAccent, contrastRatio(tokens.color.onAccent, tokens.color.accent));
});

test("typography and layout contain real responsive values", () => {
  const tokens = compileTokens(input("editorial"));
  assert.ok(tokens.typography.display.family.length > 0);
  assert.ok(tokens.typography.display.fallback.length >= 2);
  assert.equal(tokens.layout.columns.mobile, 4);
  assert.ok(tokens.layout.containerMaxPx.desktop > tokens.layout.containerMaxPx.mobile);
  assert.ok(tokens.typography.scalePx.desktop.at(-1)! > tokens.typography.scalePx.mobile.at(-1)!);
  assert.equal(tokens.interaction.rawValueBypass, false);
});

test("six page families do not collapse to one concrete token system", () => {
  const families = ["b2b-product", "editorial", "premium-consumer", "motion-heavy-creative", "interactive-2d", "interactive-3d"];
  const signatures = new Set(families.map((family) => projectSemanticTokensToCss(compileTokens(input(family)))));
  assert.ok(signatures.size >= 3);
});

test("semantic tokens bind the exact supplied visual search receipt", () => {
  const compilerInput = input("premium-consumer");
  const visualSearch = searchVisualDirections(compilerInput, "human-selected-search-seed");
  const tokens = compileSemanticDesignTokens(compilerInput, visualSearch);
  const selected = visualSearch.candidates.find((candidate) => candidate.id === visualSearch.selectedCandidateId)!;

  assert.deepEqual(tokens.sourceVisualDirection, {
    schema: visualSearch.schema,
    inputSha256: visualSearch.inputSha256,
    seed: visualSearch.seed,
    candidateId: visualSearch.selectedCandidateId,
    candidateSignature: selected.signature
  });
});

test("CSS projection includes every concrete token family used by production UI", () => {
  const css = projectSemanticTokensToCss(compileTokens(input("interactive-3d")));
  for (const variable of [
    "--wdc-type-display-weight",
    "--wdc-type-display-line-height",
    "--wdc-type-body-measure",
    "--wdc-type-scale-0",
    "--wdc-space-0",
    "--wdc-space-6",
    "--wdc-radius-sm",
    "--wdc-radius-pill",
    "--wdc-border-width",
    "--wdc-border-color",
    "--wdc-elevation-high",
    "--wdc-motion-slow",
    "--wdc-media-blur-max",
    "--wdc-focus-ring",
    "--wdc-focus-offset",
    "--wdc-target-min",
    "--wdc-hover-lift"
  ]) assert.ok(css.includes(`${variable}:`), `missing CSS projection for ${variable}`);
});

test("semantic token schema rejects unknown nested token fields", async () => {
  const tokens = compileTokens(input("b2b-product"));
  const invalid = structuredClone(tokens) as SemanticTokenFixture;
  invalid.typography.unownedRawValue = "12px";

  await assert.rejects(
    validateAgainstSchema(invalid, "semantic-design-tokens-v2.schema.json"),
    /must NOT have additional properties/
  );
});

test("production globals consume generated interaction and type tokens", async () => {
  const css = await readFile(new URL("../apps/site/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /outline: var\(--wdc-focus-ring\) solid var\(--wdc-color-focus\)/);
  assert.match(css, /outline-offset: var\(--wdc-focus-offset\)/);
  assert.match(css, /min-height: var\(--wdc-target-min\)/);
  assert.doesNotMatch(css, /outline-offset:\s*3px/);
});

type SemanticTokenFixture = ReturnType<typeof compileSemanticDesignTokens> & {
  typography: ReturnType<typeof compileSemanticDesignTokens>["typography"] & { unownedRawValue?: string };
};
