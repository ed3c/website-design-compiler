import { chromium } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { collectBrowserProjectResults } from "../src/browser-qa.js";
import { validateAgainstSchema } from "../src/validate.js";

const requiredProjects = ["storybook-desktop", "storybook-mobile"] as const;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type CandidateEnvironment = {
  gitSha: string;
  gitRef: string;
  repository: string;
  workflow: string;
  runId: number;
  runAttempt: number;
  screenshotArtifactId: number;
  screenshotArtifactName: string;
  storybookBuildExitCode: 0;
  storybookQaExitCode: 0;
};

type RuntimeMetadata = {
  runnerImage: { os: "ubuntu-24.04"; version: string; release: string };
  browser: {
    engine: "chromium";
    distribution: string;
    version: string;
    playwrightPackage: string;
    playwrightChromiumRevision: number;
  };
  fonts: Array<{ package: string; version: string }>;
};

export type StorybookGoldenCandidate = {
  schema: "website-design-compiler/storybook-golden-candidate/v1";
  state: "NOT_EXERCISED";
  promotion: "HUMAN_REVIEW_REQUIRED";
  source: {
    git: { sha: string; ref: string };
    workflow: { repository: string; name: string; runId: number; runAttempt: number };
    screenshotArtifact: { id: number; name: string };
    runnerImage: RuntimeMetadata["runnerImage"];
    browser: RuntimeMetadata["browser"];
    fonts: RuntimeMetadata["fonts"];
    projects: readonly ["storybook-desktop", "storybook-mobile"];
    qualification: {
      storybookBuild: "PASS";
      browserProjects: "PASS";
      storybookBuildExitCode: 0;
      storybookQaExitCode: 0;
      playwrightReport: { path: "artifacts/storybook/playwright-report.json"; sha256: string };
      staticBuild: { path: "artifacts/storybook/static/index.html"; sha256: string };
    };
  };
  screenshots: Record<string, string>;
};

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

function requireString(environment: EnvironmentValues, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required to bind the candidate to its GitHub run`);
  return value;
}

function requirePositiveInteger(environment: EnvironmentValues, name: string): number {
  const raw = requireString(environment, name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function requireZeroExitCode(environment: EnvironmentValues, name: string): 0 {
  const value = Number(requireString(environment, name));
  if (value !== 0) throw new Error(`${name} must record a successful zero exit code`);
  return 0;
}

async function writeAtomically(path: string, contents: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, path);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function candidateEnvironmentFromProcess(environment: EnvironmentValues): CandidateEnvironment {
  return {
    gitSha: requireString(environment, "GITHUB_SHA"),
    gitRef: requireString(environment, "GITHUB_REF"),
    repository: requireString(environment, "GITHUB_REPOSITORY"),
    workflow: requireString(environment, "GITHUB_WORKFLOW"),
    runId: requirePositiveInteger(environment, "GITHUB_RUN_ID"),
    runAttempt: requirePositiveInteger(environment, "GITHUB_RUN_ATTEMPT"),
    screenshotArtifactId: requirePositiveInteger(environment, "STORYBOOK_SCREENSHOT_ARTIFACT_ID"),
    screenshotArtifactName: requireString(environment, "STORYBOOK_SCREENSHOT_ARTIFACT_NAME"),
    storybookBuildExitCode: requireZeroExitCode(environment, "STORYBOOK_BUILD_EXIT_CODE"),
    storybookQaExitCode: requireZeroExitCode(environment, "STORYBOOK_QA_EXIT_CODE")
  };
}

export async function collectUbuntuRuntimeMetadata(environment: EnvironmentValues): Promise<RuntimeMetadata> {
  const imageOs = requireString(environment, "ImageOS");
  const imageVersion = requireString(environment, "ImageVersion");
  if (imageOs !== "ubuntu24") throw new Error(`Storybook golden candidates require ubuntu24, received ${imageOs}`);

  const require = createRequire(import.meta.url);
  const playwrightPackagePath = require.resolve("@playwright/test/package.json");
  const playwrightPackage = JSON.parse(await readFile(playwrightPackagePath, "utf8")) as { version?: unknown };
  if (typeof playwrightPackage.version !== "string") throw new Error("Cannot resolve the Playwright package version");
  const corePackagePath = createRequire(playwrightPackagePath).resolve("playwright-core/package.json");
  const browsers = JSON.parse(await readFile(join(dirname(corePackagePath), "browsers.json"), "utf8")) as {
    browsers?: Array<{ name?: unknown; revision?: unknown; browserVersion?: unknown; title?: unknown }>;
  };
  const chromiumEntry = browsers.browsers?.find((entry) => entry.name === "chromium");
  const revision = Number(chromiumEntry?.revision);
  if (!chromiumEntry || typeof chromiumEntry.title !== "string" || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Cannot resolve the installed Playwright Chromium revision");
  }
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  await browser.close();
  if (typeof chromiumEntry.browserVersion === "string" && chromiumEntry.browserVersion !== browserVersion) {
    throw new Error(`Playwright Chromium metadata ${chromiumEntry.browserVersion} does not match launched browser ${browserVersion}`);
  }

  const installedPackages = execFileSync("dpkg-query", ["-W", "-f=${Package}=${Version}\\n"], { encoding: "utf8" });
  const fonts = installedPackages
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(fontconfig|fonts-|libfreetype6=)/.test(line))
    .map((line) => {
      const separator = line.indexOf("=");
      return { package: line.slice(0, separator), version: line.slice(separator + 1) };
    })
    .filter((entry) => entry.package.length > 0 && entry.version.length > 0)
    .sort((left, right) => left.package.localeCompare(right.package));
  if (fonts.length === 0) throw new Error("No installed Ubuntu font packages were observed");

  return {
    runnerImage: { os: "ubuntu-24.04", version: imageVersion, release: `${imageOs}/${imageVersion}` },
    browser: {
      engine: "chromium",
      distribution: chromiumEntry.title,
      version: browserVersion,
      playwrightPackage: playwrightPackage.version,
      playwrightChromiumRevision: revision
    },
    fonts
  };
}

export async function writeStorybookGoldenCandidate(options: {
  screenshotsDirectory: string;
  outputPath: string;
  environment: CandidateEnvironment;
  runtime: RuntimeMetadata;
}): Promise<StorybookGoldenCandidate> {
  if (options.environment.storybookBuildExitCode !== 0 || options.environment.storybookQaExitCode !== 0) {
    throw new Error("Storybook candidate requires zero build and browser QA exit codes");
  }
  const storybookRoot = dirname(options.screenshotsDirectory);
  const reportBytes = await readFile(join(storybookRoot, "playwright-report.json"));
  const report = JSON.parse(reportBytes.toString("utf8")) as unknown;
  const projectResults = collectBrowserProjectResults(report);
  const missingOrFailedProjects = requiredProjects.filter((project) => !projectResults.some((result) => result.projectName === project && result.status === "passed"));
  if (missingOrFailedProjects.length > 0) throw new Error(`Storybook browser projects did not PASS: ${missingOrFailedProjects.join(", ")}`);
  const staticBuildBytes = await readFile(join(storybookRoot, "static", "index.html"));
  if (staticBuildBytes.length === 0) throw new Error("Storybook static build evidence is empty");
  const names = (await readdir(options.screenshotsDirectory)).filter((name) => name.endsWith(".png")).sort();
  if (names.length !== 90) throw new Error(`Expected exactly 90 Storybook screenshots, observed ${names.length}`);
  const screenshots: Record<string, string> = {};
  for (const project of requiredProjects) {
    const projectNames = names.filter((name) => name.startsWith(`${project}--`));
    if (projectNames.length !== 45) throw new Error(`Expected exactly 45 ${project} screenshots, observed ${projectNames.length}`);
  }
  for (const name of names) {
    if (!/^storybook-(desktop|mobile)--[^/]+\.png$/.test(name)) throw new Error(`Unexpected Storybook screenshot name: ${name}`);
    const bytes = await readFile(join(options.screenshotsDirectory, name));
    if (bytes.length < pngSignature.length || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw new Error(`${name} is not a PNG screenshot`);
    }
    screenshots[name] = sha256(bytes);
  }
  const candidate: StorybookGoldenCandidate = {
    schema: "website-design-compiler/storybook-golden-candidate/v1",
    state: "NOT_EXERCISED",
    promotion: "HUMAN_REVIEW_REQUIRED",
    source: {
      git: { sha: options.environment.gitSha, ref: options.environment.gitRef },
      workflow: {
        repository: options.environment.repository,
        name: options.environment.workflow,
        runId: options.environment.runId,
        runAttempt: options.environment.runAttempt
      },
      screenshotArtifact: { id: options.environment.screenshotArtifactId, name: options.environment.screenshotArtifactName },
      runnerImage: options.runtime.runnerImage,
      browser: options.runtime.browser,
      fonts: options.runtime.fonts,
      projects: requiredProjects,
      qualification: {
        storybookBuild: "PASS",
        browserProjects: "PASS",
        storybookBuildExitCode: 0,
        storybookQaExitCode: 0,
        playwrightReport: { path: "artifacts/storybook/playwright-report.json", sha256: sha256(reportBytes) },
        staticBuild: { path: "artifacts/storybook/static/index.html", sha256: sha256(staticBuildBytes) }
      }
    },
    screenshots
  };
  await validateAgainstSchema(candidate, "storybook-golden-candidate.schema.json", process.cwd());
  await writeAtomically(options.outputPath, `${JSON.stringify(candidate, null, 2)}\n`);
  return candidate;
}

async function main(): Promise<void> {
  const environment = candidateEnvironmentFromProcess(process.env);
  const candidate = await writeStorybookGoldenCandidate({
    screenshotsDirectory: join(process.cwd(), "artifacts", "storybook", "screenshots"),
    outputPath: join(process.cwd(), "artifacts", "storybook", "golden-candidate.json"),
    environment,
    runtime: await collectUbuntuRuntimeMetadata(process.env)
  });
  console.log(JSON.stringify({
    state: candidate.state,
    promotion: candidate.promotion,
    path: "artifacts/storybook/golden-candidate.json",
    screenshotCount: Object.keys(candidate.screenshots).length,
    screenshotArtifactId: candidate.source.screenshotArtifact.id
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
