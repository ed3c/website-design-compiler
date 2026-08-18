import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArenaMatrix } from "../src/arena.js";
import type { CompilerInput } from "../src/contracts.js";
import { compileContentArchitecture } from "../src/content-architecture.js";
import { compileInformationArchitecture } from "../src/information-architecture.js";
import { buildPageArchitecturePlan } from "../src/page-architect.js";
import { validateAgainstSchema } from "../src/validate.js";

const matrix = JSON.parse(await readFile(resolve("fixtures/arena/benchmark-matrix.json"), "utf8")) as ArenaMatrix;
const outputDirectory = resolve("artifacts/v2/content-architecture");
await mkdir(outputDirectory, { recursive: true });
const categories = [];
for (const benchmark of matrix.categories) {
  const input: CompilerInput = {
    schema: "website-design-compiler/input/v1",
    project: `content-${benchmark.id}`,
    brief: { pageType: benchmark.pageType, audience: benchmark.audience, objective: benchmark.objective },
    requestedStages: [...matrix.requiredCompilerStages]
  };
  const ia = compileInformationArchitecture(input);
  const content = compileContentArchitecture(input);
  const page = buildPageArchitecturePlan(input);
  await validateAgainstSchema(content, "content-architecture-v2.schema.json");
  await validateAgainstSchema(page, "page-architecture-plan.schema.json");
  const publishableFields = content.sections.flatMap((section) => section.fields).filter((field) => field.publishable);
  const forbiddenPublishable = publishableFields.filter((field) => content.forbiddenInventions.includes(field.slot));
  const provenanceComplete = publishableFields.every((field) => field.provenance.length > 0);
  const budgetsPass = publishableFields.every((field) => Array.isArray(field.value)?field.value.every((value)=>value.length<=field.lengthBudget.maxCharacters):(field.value?.length ?? 0)<=field.lengthBudget.maxCharacters);
  const sectionAlignment = JSON.stringify(content.sections.map((section) => section.sectionId)) === JSON.stringify(ia.sections.map((section) => section.id));
  const pageProjection = page.sectionIntents.every((intent) => {
    const section = content.sections.find((candidate) => candidate.sectionId === intent.id);
    return Boolean(section) && intent.contentContract.fields.length === section?.fields.length;
  });
  const missingInputs = content.sections.flatMap((section) => section.fields.filter((field) => field.state === "NEEDS_INPUT").map((field) => `${section.sectionId}:${field.slot}`));
  const state = sectionAlignment && provenanceComplete && budgetsPass && forbiddenPublishable.length === 0 && pageProjection ? "PASS" : "FAIL";
  const category = {
    id: benchmark.id,
    state,
    sectionCount: content.sections.length,
    publishableFieldCount: publishableFields.length,
    missingInputs,
    provenanceComplete,
    budgetsPass,
    forbiddenPublishableCount: forbiddenPublishable.length,
    pageProjection
  };
  categories.push(category);
  await writeFile(resolve(outputDirectory, `${benchmark.id}.json`), `${JSON.stringify(content, null, 2)}\n`, "utf8");
}
const overall = categories.length === 6 && categories.every((category) => category.state === "PASS") ? "PASS" : "FAIL";
const receipt = {
  schema: "website-design-compiler/content-architecture-benchmark-receipt/v2",
  overall,
  categoryCount: categories.length,
  categories
};
await writeFile(resolve(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ overall, categoryCount: categories.length }));
if (overall !== "PASS") process.exitCode = 1;
