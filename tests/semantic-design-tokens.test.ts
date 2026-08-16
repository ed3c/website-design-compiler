import assert from "node:assert/strict";
import test from "node:test";
import type { CompilerInput } from "../src/contracts.js";
import { compileSemanticDesignTokens, contrastRatio, projectSemanticTokensToCss } from "../src/semantic-design-tokens.js";

function input(pageType: string): CompilerInput {
  return { schema: "website-design-compiler/input/v1", project: `tokens-${pageType}`, brief: { pageType, audience: "design teams", objective: "compile a governed premium website" }, requestedStages: ["visual-direction-search", "semantic-design-tokens"] };
}

test("semantic tokens emit concrete OKLCH values with executable contrast evidence", () => {
  const tokens = compileSemanticDesignTokens(input("b2b-product"));
  assert.match(tokens.color.background, /^oklch\(/);
  assert.ok(tokens.color.contrastEvidence.textOnBackground >= 4.5);
  assert.ok(tokens.color.contrastEvidence.mutedTextOnBackground >= 4.5);
  assert.ok(tokens.color.contrastEvidence.focusOnBackground >= 3);
  assert.equal(tokens.color.contrastEvidence.textOnBackground, contrastRatio(tokens.color.text, tokens.color.background));
});

test("typography and layout contain real responsive values", () => {
  const tokens = compileSemanticDesignTokens(input("editorial"));
  assert.ok(tokens.typography.display.family.length > 0);
  assert.ok(tokens.typography.display.fallback.length >= 2);
  assert.equal(tokens.layout.columns.mobile, 4);
  assert.ok(tokens.layout.containerMaxPx.desktop > tokens.layout.containerMaxPx.mobile);
  assert.ok(tokens.typography.scalePx.desktop.at(-1)! > tokens.typography.scalePx.mobile.at(-1)!);
  assert.equal(tokens.interaction.rawValueBypass, false);
});

test("six page families do not collapse to one concrete token system", () => {
  const families = ["b2b-product", "editorial", "premium-consumer", "motion-heavy-creative", "interactive-2d", "interactive-3d"];
  const signatures = new Set(families.map((family) => projectSemanticTokensToCss(compileSemanticDesignTokens(input(family)))));
  assert.ok(signatures.size >= 3);
});
