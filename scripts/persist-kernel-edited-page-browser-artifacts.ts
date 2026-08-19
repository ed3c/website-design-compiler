import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const projects = [
  "desktop-chromium",
  "tablet-chromium",
  "mobile-chromium",
  "reduced-motion-chromium"
] as const;

type BrowserProject = typeof projects[number];

type BrowserReceiptObservation = {
  browserProject: BrowserProject;
  screenshotPath: string;
  screenshotSha256: string;
  screenshotByteLength: number;
  exactIdentityMatch: boolean;
};

type BrowserReceipt = {
  schema: "website-design-compiler/kernel-edited-page-browser-receipt/v1";
  overall: "PASS" | "FAIL";
  subjectHeadSha: string;
  observations: BrowserReceiptObservation[];
  failures: string[];
  receiptIdentitySha256: string;
};

type BrowserObservation = {
  schema: "website-design-compiler/kernel-edited-page-browser-observation/v1";
  browserProject: BrowserProject;
  subjectHeadSha: string;
  screenshotPath: string;
  screenshotSha256: string;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const root = process.cwd();
const browserRoot = join(root, "artifacts", "browser-qa");
const functionalRoot = join(browserRoot, "test-results-functional");
const sourceReceiptPath = join(functionalRoot, "kernel-edited-page-browser-receipt.json");
const durableRoot = join(root, "artifacts", "v2", "kernel-edited-page-browser");
const durableObservationRoot = join(durableRoot, "observations");
const durableScreenshotRoot = join(durableRoot, "screenshots");

const receiptBytes = await readFile(sourceReceiptPath);
const receipt = JSON.parse(receiptBytes.toString("utf8")) as BrowserReceipt;
if (receipt.schema !== "website-design-compiler/kernel-edited-page-browser-receipt/v1") {
  throw new Error("edited-page browser receipt schema is unsupported");
}
if (receipt.overall !== "PASS" || receipt.failures.length !== 0) {
  throw new Error("only a PASS edited-page browser receipt can be materialized as durable verified evidence");
}
if (receipt.observations.length !== projects.length) {
  throw new Error(`expected ${projects.length} receipt observations, found ${receipt.observations.length}`);
}

await mkdir(durableObservationRoot, { recursive: true });
await mkdir(durableScreenshotRoot, { recursive: true });

for (const project of projects) {
  const summary = receipt.observations.find((entry) => entry.browserProject === project);
  if (!summary || summary.exactIdentityMatch !== true) {
    throw new Error(`${project}: exact browser identity was not verified`);
  }
  const observationSourcePath = join(functionalRoot, "kernel-edit-evidence", `${project}.json`);
  const observationBytes = await readFile(observationSourcePath);
  const observation = JSON.parse(observationBytes.toString("utf8")) as BrowserObservation;
  if (
    observation.schema !== "website-design-compiler/kernel-edited-page-browser-observation/v1" ||
    observation.browserProject !== project ||
    observation.subjectHeadSha !== receipt.subjectHeadSha ||
    observation.screenshotPath !== summary.screenshotPath ||
    observation.screenshotSha256 !== summary.screenshotSha256
  ) {
    throw new Error(`${project}: observation drifted after independent receipt verification`);
  }

  const screenshotBytes = await readFile(join(browserRoot, summary.screenshotPath));
  const actualScreenshotSha256 = sha256(screenshotBytes);
  if (
    screenshotBytes.byteLength !== summary.screenshotByteLength ||
    actualScreenshotSha256 !== summary.screenshotSha256
  ) {
    throw new Error(`${project}: screenshot bytes drifted after independent receipt verification`);
  }

  await writeFile(join(durableObservationRoot, `${project}.json`), observationBytes);
  await writeFile(join(durableScreenshotRoot, `kernel-edit--${project}.png`), screenshotBytes);
}

await writeFile(join(durableRoot, "receipt.json"), receiptBytes);
const durableManifest = {
  schema: "website-design-compiler/kernel-edited-page-browser-artifact-manifest/v1" as const,
  subjectHeadSha: receipt.subjectHeadSha,
  receiptIdentitySha256: receipt.receiptIdentitySha256,
  receiptSha256: sha256(receiptBytes),
  observations: projects.map((project) => {
    const summary = receipt.observations.find((entry) => entry.browserProject === project)!;
    return {
      browserProject: project,
      observationPath: `observations/${project}.json`,
      screenshotPath: `screenshots/kernel-edit--${project}.png`,
      screenshotSha256: summary.screenshotSha256,
      screenshotByteLength: summary.screenshotByteLength
    };
  })
};
await writeFile(join(durableRoot, "artifact-manifest.json"), `${JSON.stringify(durableManifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ durableRoot: "artifacts/v2/kernel-edited-page-browser", subjectHeadSha: receipt.subjectHeadSha, observationCount: projects.length }));
