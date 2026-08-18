import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArenaMatrix } from "../src/arena.js";
import type { CompilerInput } from "../src/contracts.js";
import { compileInformationArchitecture } from "../src/information-architecture.js";

const matrix = JSON.parse(await readFile(resolve("fixtures/arena/benchmark-matrix.json"), "utf8")) as ArenaMatrix;
const metrics = matrix.categories.map((benchmark) => {
  const input: CompilerInput = {
    schema: "website-design-compiler/input/v1",
    project: `arena-${benchmark.id}`,
    brief: { pageType: benchmark.pageType, audience: benchmark.audience, objective: benchmark.objective },
    requestedStages: [...matrix.requiredCompilerStages]
  };
  const ia = compileInformationArchitecture(input);
  const evidenceCovered = ia.sections.filter((section) => section.evidence.length > 0).length;
  const evidenceCoverage = ia.sections.length === 0 ? 0 : Math.round((evidenceCovered / ia.sections.length) * 100);
  const signature = createHash("sha256").update(JSON.stringify(ia.sections.map((section) => [section.id, section.type, section.priority, section.status]))).digest("hex");
  const state = ia.sections.length >= 5 && evidenceCoverage === 100 && ia.navigation.mobilePriority.length >= 3 && ia.forbiddenInventions.length >= 6 ? "PASS" : "FAIL";
  return {
    id: benchmark.id,
    state,
    family: ia.family,
    sectionCount: ia.sections.length,
    readySections: ia.sections.filter((section) => section.status === "READY").length,
    needsInputSections: ia.sections.filter((section) => section.status === "NEEDS_INPUT").map((section) => section.id),
    evidenceCoverage,
    mobilePriorityCount: ia.navigation.mobilePriority.length,
    uniqueSectionTypes: new Set(ia.sections.map((section) => section.type)).size,
    forbiddenInventionCount: ia.forbiddenInventions.length,
    graphSignature: signature
  };
});
const uniqueGraphs = new Set(metrics.map((metric) => metric.graphSignature)).size;
const overall = metrics.length === 6 && uniqueGraphs === 6 && metrics.every((metric) => metric.state === "PASS") ? "PASS" : "FAIL";
const receipt = {
  schema: "website-design-compiler/arena-ia-metrics/v2",
  overall,
  categoryCount: metrics.length,
  uniqueGraphCount: uniqueGraphs,
  categories: metrics
};
await mkdir(resolve("artifacts/arena"), { recursive: true });
await writeFile(resolve("artifacts/arena/ia-metrics.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ overall, categoryCount: metrics.length, uniqueGraphCount: uniqueGraphs }));
if (overall !== "PASS") process.exitCode = 1;
