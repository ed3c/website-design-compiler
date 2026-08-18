import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompilerInput } from "../src/contracts.js";
import { compileSemanticDesignTokens, projectSemanticTokensToCss } from "../src/semantic-design-tokens.js";
import { searchVisualDirections } from "../src/visual-direction-search.js";
import { validateAgainstSchema } from "../src/validate.js";

const input = JSON.parse(await readFile(resolve("fixtures/showcase/compiler-input.json"), "utf8")) as CompilerInput;
const tokens = compileSemanticDesignTokens(input,searchVisualDirections(input));
await validateAgainstSchema(tokens, "semantic-design-tokens-v2.schema.json");
const generated = projectSemanticTokensToCss(tokens);
const checkedIn = await readFile(resolve("apps/site/app/theme.generated.css"), "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const projectionMatches = generated === checkedIn;
const outputDirectory = resolve("artifacts/v2/semantic-design-tokens");
await mkdir(outputDirectory, { recursive: true });
const receipt = {
  schema: "website-design-compiler/semantic-token-projection-receipt/v2",
  overall: projectionMatches ? "PASS" : "FAIL",
  project: input.project,
  sourceVisualDirection: tokens.sourceVisualDirection,
  generatedSha256: sha(generated),
  checkedInSha256: sha(checkedIn),
  projectionMatches,
  productionConsumer: "apps/site/app/globals.css -> theme.generated.css"
};
await writeFile(resolve(outputDirectory, "projection-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
if (!projectionMatches) {
  await writeFile(resolve(outputDirectory, "expected-theme.css"), generated, "utf8");
  console.error(JSON.stringify(receipt));
  process.exitCode = 1;
} else console.log(JSON.stringify(receipt));
