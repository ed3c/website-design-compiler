import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { collectBrowserProjectResults } from "../src/browser-qa.js";

const root = join(process.cwd(), "artifacts", "storybook");
const uiDirectory = join(process.cwd(), "apps", "site", "components", "ui");
const requiredProjects = ["storybook-desktop", "storybook-mobile"];
const requiredStates = ["Loading", "Empty", "Error", "Success"];
const requiredButtonStories = ["Primary", "Secondary", "Disabled"];

async function walk(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory);
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry);
      const info = await stat(path);
      if (info.isDirectory()) files.push(...await walk(path));
      else files.push(path);
    }
    return files;
  } catch {
    return [];
  }
}

await mkdir(root, { recursive: true });
const uiEntries = await readdir(uiDirectory);
const publicComponents = uiEntries
  .filter((name) => name.endsWith(".tsx") && !name.endsWith(".stories.tsx"))
  .map((name) => name.replace(/\.tsx$/, ""))
  .sort();
const storyComponents = uiEntries
  .filter((name) => name.endsWith(".stories.tsx"))
  .map((name) => name.replace(/\.stories\.tsx$/, ""))
  .sort();
const missingStories = publicComponents.filter((component) => !storyComponents.includes(component));

const statusStorySource = await readFile(join(uiDirectory, "status-panel.stories.tsx"), "utf8");
const buttonStorySource = await readFile(join(uiDirectory, "button.stories.tsx"), "utf8");
const missingStatusStates = requiredStates.filter((name) => !statusStorySource.includes(`export const ${name}:`));
const missingButtonStates = requiredButtonStories.filter((name) => !buttonStorySource.includes(`export const ${name}:`));

let report: unknown = null;
try {
  report = JSON.parse(await readFile(join(root, "playwright-report.json"), "utf8")) as unknown;
} catch {}
const projectResults = collectBrowserProjectResults(report);
const passedProjects = new Set(projectResults.filter((result) => result.status === "passed").map((result) => result.projectName));
const failedProjects = projectResults.filter((result) => result.status === "failed").map((result) => result.projectName).sort();
const missingProjects = requiredProjects.filter((project) => !passedProjects.has(project));

const files = await walk(root);
const screenshots = files.filter((path) => path.endsWith(".png"));
const expectedScreenshotCount = 14;
const staticBuild = files.some((path) => path.endsWith(join("static", "index.html")));

const gates = {
  publicComponentCoverage: missingStories.length === 0 ? "PASS" : "FAIL",
  statusStateMatrix: missingStatusStates.length === 0 ? "PASS" : "FAIL",
  buttonStateMatrix: missingButtonStates.length === 0 ? "PASS" : "FAIL",
  storybookBuild: staticBuild ? "PASS" : "FAIL",
  browserProjects: missingProjects.length === 0 && failedProjects.length === 0 ? "PASS" : "FAIL",
  visualCandidates: screenshots.length >= expectedScreenshotCount ? "PASS" : "FAIL"
} as const;
const overall = Object.values(gates).every((state) => state === "PASS") ? "PASS" : "FAIL";

const receipt = {
  schema: "website-design-compiler/storybook-workshop-receipt/v1",
  overall,
  git: { sha: process.env.GITHUB_SHA ?? "UNBOUND", ref: process.env.GITHUB_REF ?? "UNBOUND" },
  publicComponents,
  storyComponents,
  missingStories,
  requiredStates,
  missingStatusStates,
  requiredButtonStories,
  missingButtonStates,
  requiredProjects,
  projectResults,
  failedProjects,
  missingProjects,
  screenshots: screenshots.map((path) => basename(path)).sort(),
  expectedScreenshotCount,
  visualRegression: "CANDIDATE_BASELINE",
  gates
};

const receiptPath = join(root, "storybook-workshop.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, overall, missingStories, missingProjects }));
if (overall !== "PASS") process.exitCode = 1;
