import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(process.cwd(), "artifacts", "browser-qa");
const reportPath = join(root, "playwright-report.json");
const receiptPath = join(root, "browser-qa.json");
const requiredProjects = [
  "desktop-chromium",
  "tablet-chromium",
  "mobile-chromium",
  "reduced-motion-chromium"
];

type ResultRecord = { projectName?: string; status?: string };

async function walk(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory);
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry);
      const info = await stat(path);
      if (info.isDirectory()) files.push(...(await walk(path)));
      else files.push(path);
    }
    return files;
  } catch {
    return [];
  }
}

function collectResults(value: unknown, results: ResultRecord[] = []): ResultRecord[] {
  if (!value || typeof value !== "object") return results;
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.results)) {
    for (const result of object.results) {
      if (result && typeof result === "object") {
        const typed = result as Record<string, unknown>;
        const record: ResultRecord = {};
        if (typeof typed.projectName === "string") record.projectName = typed.projectName;
        if (typeof typed.status === "string") record.status = typed.status;
        results.push(record);
      }
    }
  }
  for (const nested of Object.values(object)) {
    if (Array.isArray(nested)) {
      for (const item of nested) collectResults(item, results);
    } else if (nested && typeof nested === "object") {
      collectResults(nested, results);
    }
  }
  return results;
}

await mkdir(root, { recursive: true });
const files = await walk(root);
const screenshots = files.filter((path) => path.endsWith(".png")).map((path) => relative(root, path));
const traces = files.filter((path) => path.endsWith("trace.zip")).map((path) => relative(root, path));

let report: unknown = null;
try {
  report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
} catch {
  report = null;
}
const results = collectResults(report);
const passedProjects = new Set(
  results.filter((result) => result.status === "passed" && result.projectName).map((result) => result.projectName as string)
);
const missingProjects = requiredProjects.filter((project) => !passedProjects.has(project));
const missingScreenshots = requiredProjects.filter(
  (project) => !screenshots.some((path) => path.endsWith(`${project}.png`))
);

const overall = report !== null && missingProjects.length === 0 && missingScreenshots.length === 0 && traces.length >= requiredProjects.length
  ? "PASS"
  : "FAIL";

const receipt = {
  schema: "website-design-compiler/browser-qa/v1",
  overall,
  git: {
    sha: process.env.GITHUB_SHA ?? "UNBOUND",
    ref: process.env.GITHUB_REF ?? "UNBOUND"
  },
  requiredProjects,
  passedProjects: [...passedProjects].sort(),
  missingProjects,
  screenshots: screenshots.sort(),
  missingScreenshots,
  traces: traces.sort(),
  gates: {
    browserMatrix: missingProjects.length === 0 ? "PASS" : "FAIL",
    screenshots: missingScreenshots.length === 0 ? "PASS" : "FAIL",
    traces: traces.length >= requiredProjects.length ? "PASS" : "FAIL",
    playwrightReport: report !== null ? "PASS" : "FAIL"
  }
};

await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, overall }));
if (overall !== "PASS") process.exitCode = 1;
