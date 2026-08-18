import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { collectBrowserProjectResults } from "../src/browser-qa.js";
import {
  hashScreenshotSet,
  validateIndependentVisualReview,
  type IndependentVisualReview
} from "../src/storybook-visual-review.js";
import { validateAgainstSchema } from "../src/validate.js";

const execFileAsync = promisify(execFile);

const root = join(process.cwd(), "artifacts", "storybook");
const uiDirectory = join(process.cwd(), "apps", "site", "components", "ui");
const goldenPath = join(process.cwd(), "fixtures", "storybook", "visual-goldens.json");
const reviewPath = join(process.cwd(), "fixtures", "storybook", "visual-review.json");
const sectionProjectionPath = join(process.cwd(), "artifacts", "v2", "section-grammar", "projections.json");
const requiredProjects = ["storybook-desktop", "storybook-mobile"];
const requiredStates = ["Loading", "Empty", "Error", "Success"];
const requiredButtonStories = ["Primary", "Secondary", "Disabled"];
const diagnostics: string[] = [];

type GoldenManifest = {
  schema: "website-design-compiler/storybook-visual-goldens/v3";
  source: {
    kind: "agent-visual-review";
    subjectCommit: string;
    subjectTree: string;
    sourceFilesSha256: string;
    screenshotSetSha256: string;
    reviewReceiptSha256: string;
    node: string;
    playwright: string;
    browser: string;
    projects: string[];
  };
  screenshots: Record<string, string>;
};

type SectionProjection = { kind: string; storyId: string };

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates].sort();
}

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
  } catch (error) {
    diagnostics.push(`cannot inspect ${directory}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const reviewedSourceRoots = [
  "apps/site/app",
  "apps/site/components",
  "apps/site/.storybook",
  "fixtures/showcase",
  "src/semantic-design-tokens.ts",
  "tests/storybook",
  "playwright.storybook.config.ts",
  "tsconfig.storybook.json"
];

async function reviewedSourceSha256(): Promise<string> {
  const paths = (await Promise.all(reviewedSourceRoots.map(async (rootPath) => {
    const path = join(process.cwd(), rootPath);
    try {
      return (await stat(path)).isDirectory() ? walk(path) : [path];
    } catch (error) {
      diagnostics.push(`cannot inspect reviewed source ${rootPath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  })))
    .flat()
    .filter((path) => /\.(?:css|html|json|mjs|ts|tsx)$/.test(path))
    .sort();
  const digest = createHash("sha256");
  for (const path of paths) {
    digest.update(path.slice(process.cwd().length + 1));
    digest.update("\0");
    digest.update(await readFile(path));
    digest.update("\0");
  }
  return digest.digest("hex");
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

let sectionProjections: SectionProjection[] = [];
try {
  sectionProjections = JSON.parse(await readFile(sectionProjectionPath, "utf8")) as SectionProjection[];
} catch (error) {
  diagnostics.push(`cannot load section projections: ${error instanceof Error ? error.message : String(error)}`);
}

let report: unknown = null;
try {
  report = JSON.parse(await readFile(join(root, "playwright-report.json"), "utf8")) as unknown;
} catch (error) {
  diagnostics.push(`cannot load Playwright report: ${error instanceof Error ? error.message : String(error)}`);
}
const projectResults = collectBrowserProjectResults(report);
const passedProjects = new Set(projectResults.filter((result) => result.status === "passed").map((result) => result.projectName));
const failedProjects = projectResults.filter((result) => result.status === "failed").map((result) => result.projectName).sort();
const missingProjects = requiredProjects.filter((project) => !passedProjects.has(project));

const files = await walk(root);
const screenshotPaths = files.filter((path) => path.endsWith(".png") && path.includes(`${join("storybook", "screenshots")}`));
const screenshots = screenshotPaths.map((path) => basename(path)).sort();
const duplicateScreenshotNames = duplicateValues(screenshots);
const screenshotSet = new Set(screenshots);
const missingSectionScreenshots = sectionProjections.flatMap((projection) =>
  requiredProjects
    .map((project) => `${project}--${projection.storyId}.png`)
    .filter((name) => !screenshotSet.has(name))
);
const staticBuild = files.some((path) => path.endsWith(join("static", "index.html")));

let golden: GoldenManifest | null = null;
let review: IndependentVisualReview | null = null;
try {
  const parsed = JSON.parse(await readFile(goldenPath, "utf8")) as GoldenManifest;
  await validateAgainstSchema(parsed, "storybook-visual-goldens-v3.schema.json");
  if (parsed.schema === "website-design-compiler/storybook-visual-goldens/v3") golden = parsed;
} catch (error) {
  diagnostics.push(`cannot load visual golden manifest: ${error instanceof Error ? error.message : String(error)}`);
}
try {
  const parsed = JSON.parse(await readFile(reviewPath, "utf8")) as IndependentVisualReview;
  await validateAgainstSchema(parsed, "storybook-visual-review-v2.schema.json");
  if (parsed.schema === "website-design-compiler/storybook-visual-review/v2") review = parsed;
} catch (error) {
  diagnostics.push(`cannot load visual review receipt: ${error instanceof Error ? error.message : String(error)}`);
}

const actualHashes: Record<string, string> = {};
for (const path of screenshotPaths) actualHashes[basename(path)] = await sha256(path);
const expectedNames = Object.keys(golden?.screenshots ?? {}).sort();
const actualNames = Object.keys(actualHashes).sort();
const missingGoldenScreenshots = expectedNames.filter((name) => !(name in actualHashes));
const unexpectedScreenshots = actualNames.filter((name) => !expectedNames.includes(name));
const visualMismatches = expectedNames
  .filter((name) => name in actualHashes && actualHashes[name] !== golden?.screenshots[name])
  .map((name) => ({ name, expected: golden?.screenshots[name] ?? null, actual: actualHashes[name] ?? null }));
const sourceFilesSha256 = await reviewedSourceSha256();
const screenshotSetSha256 = hashScreenshotSet(actualHashes);
const reviewReceiptSha256 = review ? await sha256(reviewPath) : null;
const duplicateVisualReviews = duplicateValues((review?.screenshots ?? []).map((entry) => entry.name));
const reviewedByName = new Map((review?.screenshots ?? []).map((entry) => [entry.name, entry]));
const missingVisualReviews = actualNames.filter((name) => !reviewedByName.has(name));
const unexpectedVisualReviews = [...reviewedByName.keys()].filter((name) => !actualNames.includes(name)).sort();
const failedVisualReviews = [...reviewedByName.values()]
  .filter((entry) => entry.verdict !== "PASS" || entry.observations.length === 0 || actualHashes[entry.name] !== entry.sha256)
  .map((entry) => entry.name)
  .sort();
const independentReviewDiagnostics: string[] = [];
let reviewSubjectTree: string | null = null;
let reviewSubjectIsAncestor = false;
if (review) {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--verify", `${review.subject.commit}^{tree}`], { cwd: process.cwd() });
    reviewSubjectTree = result.stdout.trim();
    if (reviewSubjectTree !== review.subject.tree) independentReviewDiagnostics.push("review subject tree does not match Git");
    await execFileAsync("git", ["merge-base", "--is-ancestor", review.subject.commit, "HEAD"], { cwd: process.cwd() });
    reviewSubjectIsAncestor = true;
  } catch (error) {
    independentReviewDiagnostics.push(`review subject is not a verifiable ancestor: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!golden) independentReviewDiagnostics.push("visual golden manifest is absent");
  else independentReviewDiagnostics.push(...validateIndependentVisualReview(review, {
    subjectCommit: golden.source.subjectCommit,
    subjectTree: golden.source.subjectTree,
    sourceFilesSha256,
    screenshotHashes: actualHashes
  }));
}
const visualReviewPass = golden !== null && review !== null &&
  golden.source.sourceFilesSha256 === sourceFilesSha256 &&
  golden.source.screenshotSetSha256 === screenshotSetSha256 &&
  golden.source.screenshotSetSha256 === hashScreenshotSet(golden.screenshots) &&
  golden.source.reviewReceiptSha256 === reviewReceiptSha256 &&
  reviewSubjectIsAncestor && independentReviewDiagnostics.length === 0 &&
  duplicateScreenshotNames.length === 0 && duplicateVisualReviews.length === 0 &&
  missingVisualReviews.length === 0 && unexpectedVisualReviews.length === 0 && failedVisualReviews.length === 0;
const visualRegressionPass = golden !== null && visualReviewPass && missingGoldenScreenshots.length === 0 && unexpectedScreenshots.length === 0 && visualMismatches.length === 0;

const gates = {
  inputDiagnostics: diagnostics.length === 0 ? "PASS" : "FAIL",
  publicComponentCoverage: missingStories.length === 0 ? "PASS" : "FAIL",
  statusStateMatrix: missingStatusStates.length === 0 ? "PASS" : "FAIL",
  buttonStateMatrix: missingButtonStates.length === 0 ? "PASS" : "FAIL",
  storybookBuild: staticBuild ? "PASS" : "FAIL",
  browserProjects: missingProjects.length === 0 && failedProjects.length === 0 ? "PASS" : "FAIL",
  richSectionRuntimeCoverage: sectionProjections.length === 18 && missingSectionScreenshots.length === 0 ? "PASS" : "FAIL",
  visualReview: visualReviewPass ? "PASS" : "FAIL",
  visualRegression: visualRegressionPass ? "PASS" : "FAIL"
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
  screenshots,
  duplicateScreenshotNames,
  reviewedSourceRoots,
  sourceFilesSha256,
  screenshotSetSha256,
  diagnostics,
  richSections: {
    expectedCount: sectionProjections.length,
    storyIds: sectionProjections.map((projection) => projection.storyId).sort(),
    missingSectionScreenshots
  },
  visualRegression: visualRegressionPass ? "PASS" : "FAIL",
  visualReview: review ? {
    subject: review.subject,
    reviewer: review.reviewer,
    reviewReceiptSha256,
    reviewSubjectTree,
    reviewSubjectIsAncestor,
    independentReviewDiagnostics,
    expectedCount: actualNames.length,
    reviewedCount: review.screenshots.length,
    missingVisualReviews,
    unexpectedVisualReviews,
    duplicateVisualReviews,
    failedVisualReviews
  } : null,
  visualGoldens: golden ? {
    schema: golden.schema,
    source: golden.source,
    expectedCount: expectedNames.length,
    actualCount: actualNames.length,
    missingGoldenScreenshots,
    unexpectedScreenshots,
    mismatches: visualMismatches,
    actualHashes
  } : null,
  gates
};

const receiptPath = join(root, "storybook-workshop.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, overall, missingStories, missingProjects, missingSectionScreenshots, visualRegression: receipt.visualRegression, visualMismatches, missingVisualReviews, failedVisualReviews }));
if (overall !== "PASS") process.exitCode = 1;
