import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { collectBrowserProjectResults } from "../src/browser-qa.js";

const root = join(process.cwd(), "artifacts", "browser-qa");
const reportPath = join(root, "playwright-report.json");
const runtimeReportPath = join(root, "playwright-runtime-report.json");
const receiptPath = join(root, "browser-qa.json");
const requiredProjects = [
  "desktop-chromium",
  "tablet-chromium",
  "mobile-chromium",
  "reduced-motion-chromium"
];

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

await mkdir(root, { recursive: true });
const files = await walk(root);
const screenshots = files.filter((path) => path.endsWith(".png")).map((path) => relative(root, path));
const traces = files.filter((path) => path.endsWith("trace.zip")).map((path) => relative(root, path));

let report: unknown = null;
let runtimeReport: unknown = null;
try {
  report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
} catch {
  report = null;
}
try {
  runtimeReport = JSON.parse(await readFile(runtimeReportPath, "utf8")) as unknown;
} catch {
  runtimeReport = null;
}

const functionalProjectResults = collectBrowserProjectResults(report);
const runtimeProjectResults = collectBrowserProjectResults(runtimeReport);
const projectResults = requiredProjects.map((projectName) => {
  const states = [functionalProjectResults, runtimeProjectResults].map((results) => results.find((entry) => entry.projectName === projectName)?.status ?? "unknown");
  const status = states.includes("failed") ? "failed" as const : states.every((state) => state === "passed") ? "passed" as const : states.every((state) => state === "skipped") ? "skipped" as const : "unknown" as const;
  return { projectName, status };
});
const passedProjects = new Set(
  projectResults.filter((result) => result.status === "passed").map((result) => result.projectName)
);
const failedProjects = projectResults
  .filter((result) => result.status === "failed")
  .map((result) => result.projectName)
  .sort();
const missingProjects = requiredProjects.filter((project) => !passedProjects.has(project));
const missingScreenshots = requiredProjects.filter(
  (project) => !screenshots.some((path) => path === `screenshots/${project}.png`)
);

const browserMatrixPass = missingProjects.length === 0 && failedProjects.length === 0;
const screenshotsPass = missingScreenshots.length === 0;
const tracesPass = traces.length >= requiredProjects.length;
const reportPass = report !== null;
const runtimeReportPass = runtimeReport !== null;
const overall = browserMatrixPass && screenshotsPass && tracesPass && reportPass && runtimeReportPass ? "PASS" : "FAIL";

const receipt = {
  schema: "website-design-compiler/browser-qa-runtime-receipt/v1",
  overall,
  git: {
    sha: process.env.GITHUB_SHA ?? "UNBOUND",
    ref: process.env.GITHUB_REF ?? "UNBOUND"
  },
  requiredProjects,
  functionalProjectResults,
  runtimeProjectResults,
  projectResults,
  passedProjects: [...passedProjects].sort(),
  failedProjects,
  missingProjects,
  artifacts: {
    report: reportPass ? "playwright-report.json" : null,
    runtimeReport: runtimeReportPass ? "playwright-runtime-report.json" : null,
    screenshots: screenshots.sort(),
    traces: traces.sort()
  },
  missingScreenshots,
  gates: {
    browserMatrix: browserMatrixPass ? "PASS" : "FAIL",
    screenshots: screenshotsPass ? "PASS" : "FAIL",
    traces: tracesPass ? "PASS" : "FAIL",
    playwrightReport: reportPass ? "PASS" : "FAIL",
    playwrightRuntimeReport: runtimeReportPass ? "PASS" : "FAIL"
  }
};

await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, overall }));
if (overall !== "PASS") process.exitCode = 1;
