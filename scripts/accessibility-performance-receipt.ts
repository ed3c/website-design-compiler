import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReleaseBudgets } from "../src/quality-gates.js";

const root = process.cwd();
const policyPath = join(root, "policies", "release-budgets.json");
const outputDirectory = join(root, "artifacts", "accessibility-performance");
const outputPath = join(outputDirectory, "accessibility-performance.json");
const policyBytes = await readFile(policyPath);
const budgets = JSON.parse(policyBytes.toString("utf8")) as ReleaseBudgets;

const projectEvidence: Array<Record<string, unknown>> = [];
const missingProjects: string[] = [];
for (const project of budgets.requiredProjects) {
  const path = join(outputDirectory, `${project}.json`);
  try {
    projectEvidence.push(JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>);
  } catch {
    missingProjects.push(project);
  }
}

const failedProjects = projectEvidence
  .filter((entry) => entry.overall !== "PASS")
  .map((entry) => String(entry.project ?? "unknown"));
const overall = missingProjects.length === 0 && failedProjects.length === 0 && projectEvidence.length === budgets.requiredProjects.length
  ? "PASS"
  : "FAIL";

const receipt = {
  schema: "website-design-compiler/accessibility-performance-receipt/v1",
  overall,
  git: {
    sha: process.env.GITHUB_SHA ?? "UNBOUND",
    ref: process.env.GITHUB_REF ?? "UNBOUND"
  },
  configuration: {
    path: "policies/release-budgets.json",
    schema: budgets.schema,
    version: budgets.version,
    sha256: createHash("sha256").update(policyBytes).digest("hex"),
    exceptions: budgets.exceptions
  },
  requiredProjects: budgets.requiredProjects,
  missingProjects,
  failedProjects,
  projects: projectEvidence
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath: outputPath, overall, missingProjects, failedProjects }));
if (overall !== "PASS") process.exitCode = 1;
