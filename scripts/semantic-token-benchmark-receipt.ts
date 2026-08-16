import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArenaMatrix } from "../src/arena.js";
import type { CompilerInput } from "../src/contracts.js";
import { compileSemanticDesignTokens, projectSemanticTokensToCss } from "../src/semantic-design-tokens.js";
import { validateAgainstSchema } from "../src/validate.js";

const matrix = JSON.parse(await readFile(resolve("fixtures/arena/benchmark-matrix.json"), "utf8")) as ArenaMatrix;
const outputDirectory = resolve("artifacts/v2/semantic-design-tokens");
await mkdir(outputDirectory, { recursive: true });
const categories = [];
for (const benchmark of matrix.categories) {
  const input: CompilerInput = {
    schema: "website-design-compiler/input/v1",
    project: `tokens-${benchmark.id}`,
    brief: { pageType: benchmark.pageType, audience: benchmark.audience, objective: benchmark.objective },
    requestedStages: [...matrix.requiredCompilerStages, "semantic-design-tokens"]
  };
  const tokens = compileSemanticDesignTokens(input);
  await validateAgainstSchema(tokens, "semantic-design-tokens-v2.schema.json");
  const css = projectSemanticTokensToCss(tokens);
  const cssSha256 = createHash("sha256").update(css).digest("hex");
  const contrast = tokens.color.contrastEvidence;
  const state = contrast.textOnBackground >= 4.5 && contrast.mutedTextOnBackground >= 4.5 && contrast.onAccentOnAccent >= 4.5 && contrast.focusOnBackground >= 3 && tokens.interaction.rawValueBypass === false ? "PASS" : "FAIL";
  categories.push({ id: benchmark.id, state, sourceVisualDirection: tokens.sourceVisualDirection, cssSha256, displayFamily: tokens.typography.display.family, desktopContainerPx: tokens.layout.containerMaxPx.desktop, desktopColumns: tokens.layout.columns.desktop, contrast });
  await writeFile(resolve(outputDirectory, `${benchmark.id}.json`), `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
  await writeFile(resolve(outputDirectory, `${benchmark.id}.css`), css, "utf8");
}
const uniqueCss = new Set(categories.map((entry) => entry.cssSha256)).size;
const overall = categories.length === 6 && categories.every((entry) => entry.state === "PASS") && uniqueCss >= 3 ? "PASS" : "FAIL";
const receipt = { schema: "website-design-compiler/semantic-token-benchmark-receipt/v2", overall, categoryCount: categories.length, uniqueCssSystems: uniqueCss, categories };
await writeFile(resolve(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ overall, categoryCount: categories.length, uniqueCssSystems: uniqueCss }));
if (overall !== "PASS") process.exitCode = 1;
