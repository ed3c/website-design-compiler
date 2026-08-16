import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeBrief, type NaturalLanguageBriefInput } from "../src/brief-normalizer.js";
import { compileInformationArchitecture } from "../src/information-architecture.js";
import { validateAgainstSchema } from "../src/validate.js";

const inputPath = resolve("fixtures/v2/brief-ready.json");
const outputDirectory = resolve("artifacts/v2/brief-ia");
await mkdir(outputDirectory, { recursive: true });

const raw = JSON.parse(await readFile(inputPath, "utf8")) as NaturalLanguageBriefInput;
const normalization = normalizeBrief(raw);
await validateAgainstSchema(normalization, "brief-normalization-v2.schema.json");
await writeFile(resolve(outputDirectory, "brief-normalization.json"), `${JSON.stringify(normalization, null, 2)}\n`, "utf8");

if (normalization.state !== "READY" || !normalization.compilerInput) {
  console.error(JSON.stringify({ overall: "FAIL", reason: "brief normalization did not produce a compiler-ready input", needsInput: normalization.needsInput }));
  process.exitCode = 1;
} else {
  const ia = compileInformationArchitecture(normalization.compilerInput);
  await validateAgainstSchema(ia, "information-architecture-v2.schema.json");
  await writeFile(resolve(outputDirectory, "information-architecture.json"), `${JSON.stringify(ia, null, 2)}\n`, "utf8");
  const receipt = {
    schema: "website-design-compiler/v2-brief-ia-fixture-receipt/v1",
    overall: "PASS",
    project: normalization.project,
    inputSha256: normalization.inputSha256,
    normalizationState: normalization.state,
    family: ia.family,
    sectionCount: ia.sections.length,
    needsInputSections: ia.sections.filter((section) => section.status === "NEEDS_INPUT").map((section) => section.id),
    artifacts: ["brief-normalization.json", "information-architecture.json"]
  };
  await writeFile(resolve(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt));
}
