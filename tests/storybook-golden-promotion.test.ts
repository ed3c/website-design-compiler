import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { candidateEnvironmentFromProcess, writeStorybookGoldenCandidate } from "../scripts/storybook-golden-candidate.js";
import { evaluateReviewedGoldenAdmission, promoteStorybookGoldenCandidate, validateReviewedGoldenManifest } from "../scripts/storybook-golden-promote.js";
import { validateAgainstSchema } from "../src/validate.js";

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

async function candidateFixture(options: { duplicatePixels?: boolean; mobileStatus?: "passed" | "failed" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "wdc-storybook-golden-"));
  const screenshotsDirectory = join(root, "screenshots");
  const candidatePath = join(root, "candidate.json");
  await mkdir(screenshotsDirectory, { recursive: true });
  await mkdir(join(root, "static"), { recursive: true });
  await writeFile(join(root, "playwright-report.json"), JSON.stringify({ suites: [{ specs: [{ tests: [
    { projectName: "storybook-desktop", results: [{ status: "passed" }] },
    { projectName: "storybook-mobile", results: [{ status: options.mobileStatus ?? "passed" }] }
  ] }] }] }));
  await writeFile(join(root, "static", "index.html"), "<!doctype html><title>Storybook</title>");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  for (const project of ["storybook-desktop", "storybook-mobile"] as const) {
    for (let index = 0; index < 45; index += 1) {
      await writeFile(
        join(screenshotsDirectory, `${project}--story-${index.toString().padStart(2, "0")}.png`),
        Buffer.concat([png, Buffer.from(options.duplicatePixels && index === 0 ? "shared-first-story" : `${project}:${index}`)])
      );
    }
  }
  const candidate = await writeStorybookGoldenCandidate({
    screenshotsDirectory,
    outputPath: candidatePath,
    environment: {
      gitSha: "a".repeat(40),
      gitRef: "refs/heads/codex/review",
      runtimeGitSha: "c".repeat(40),
      runtimeGitRef: "refs/pull/42/merge",
      repository: "ed3c/website-design-compiler",
      workflow: "compiler-core",
      runId: 1234,
      runAttempt: 1,
      screenshotArtifactId: 9876,
      screenshotArtifactName: `storybook-golden-screenshots-${"a".repeat(40)}-1`,
      storybookBuildExitCode: 0,
      storybookQaExitCode: 0
    },
    runtime: {
      runnerImage: { os: "ubuntu-24.04", version: "20260810.271.1", release: "ubuntu24/20260810.271" },
      browser: {
        engine: "chromium",
        distribution: "Chrome for Testing",
        version: "151.0.7922.34",
        playwrightPackage: "1.62.1",
        playwrightChromiumRevision: 1234
      },
      fonts: [
        { package: "fontconfig", version: "2.15.0-1" },
        { package: "fonts-dejavu-core", version: "2.37-8" }
      ]
    }
  });
  return { root, screenshotsDirectory, candidatePath, candidate };
}

test("Ubuntu screenshot evidence is emitted only as a review-required candidate", async () => {
  const fixture = await candidateFixture({ duplicatePixels: true });
  assert.equal(fixture.candidate.state, "NOT_EXERCISED");
  assert.equal(fixture.candidate.promotion, "HUMAN_REVIEW_REQUIRED");
  assert.equal(fixture.candidate.source.screenshotArtifact.id, 9876);
  assert.equal(fixture.candidate.source.qualification.storybookBuild, "PASS");
  assert.equal(fixture.candidate.source.qualification.browserProjects, "PASS");
  assert.equal(Object.keys(fixture.candidate.screenshots).length, 90);
  assert.equal(new Set(Object.values(fixture.candidate.screenshots)).size, 89, "legitimate identical visual states remain admissible candidates");
  await assert.rejects(
    validateAgainstSchema(fixture.candidate, "storybook-visual-goldens.schema.json", process.cwd()),
    /must match exactly one schema in oneOf/
  );
});

test("candidate generation fails closed when a Storybook browser project did not pass", async () => {
  await assert.rejects(candidateFixture({ mobileStatus: "failed" }), /storybook-mobile/);
});

test("candidate environment requires explicit zero build and browser QA exit outputs", () => {
  const environment = {
    GITHUB_SHA: "a".repeat(40),
    GITHUB_REF: "refs/pull/42/merge",
    WDC_STORYBOOK_CANDIDATE_GIT_SHA: "b".repeat(40),
    WDC_STORYBOOK_CANDIDATE_GIT_REF: "refs/heads/codex/review",
    WDC_STORYBOOK_RUNTIME_GIT_SHA: "a".repeat(40),
    WDC_STORYBOOK_RUNTIME_GIT_REF: "refs/pull/42/merge",
    GITHUB_REPOSITORY: "ed3c/website-design-compiler",
    GITHUB_WORKFLOW: "compiler-core",
    GITHUB_RUN_ID: "1234",
    GITHUB_RUN_ATTEMPT: "1",
    STORYBOOK_SCREENSHOT_ARTIFACT_ID: "9876",
    STORYBOOK_SCREENSHOT_ARTIFACT_NAME: `storybook-golden-screenshots-${"a".repeat(40)}-1`,
    STORYBOOK_BUILD_EXIT_CODE: "1",
    STORYBOOK_QA_EXIT_CODE: "0"
  };
  assert.throws(() => candidateEnvironmentFromProcess(environment), /STORYBOOK_BUILD_EXIT_CODE.*zero exit code/);
});

test("candidate environment binds the durable branch head instead of the synthetic PR merge ref", () => {
  const environment = {
    GITHUB_SHA: "a".repeat(40),
    GITHUB_REF: "refs/pull/42/merge",
    WDC_STORYBOOK_CANDIDATE_GIT_SHA: "b".repeat(40),
    WDC_STORYBOOK_CANDIDATE_GIT_REF: "refs/heads/codex/review",
    WDC_STORYBOOK_RUNTIME_GIT_SHA: "a".repeat(40),
    WDC_STORYBOOK_RUNTIME_GIT_REF: "refs/pull/42/merge",
    GITHUB_REPOSITORY: "ed3c/website-design-compiler",
    GITHUB_WORKFLOW: "compiler-core",
    GITHUB_RUN_ID: "1234",
    GITHUB_RUN_ATTEMPT: "1",
    STORYBOOK_SCREENSHOT_ARTIFACT_ID: "9876",
    STORYBOOK_SCREENSHOT_ARTIFACT_NAME: `storybook-golden-screenshots-${"b".repeat(40)}-1`,
    STORYBOOK_BUILD_EXIT_CODE: "0",
    STORYBOOK_QA_EXIT_CODE: "0"
  };

  const candidate = candidateEnvironmentFromProcess(environment);
  assert.equal(candidate.gitSha, "b".repeat(40));
  assert.equal(candidate.gitRef, "refs/heads/codex/review");
  assert.equal(candidate.runtimeGitSha, "a".repeat(40));
  assert.equal(candidate.runtimeGitRef, "refs/pull/42/merge");
});

test("workflow uploads a candidate manifest only after zero Storybook exits and producer success", async () => {
  const workflow = YAML.parse(await readFile(join(process.cwd(), ".github", "workflows", "compiler-core.yml"), "utf8")) as {
    jobs: { verify: { steps: Array<{ id?: string; if?: string; env?: Record<string, string>; with?: Record<string, string | number> }> } };
  };
  const steps = workflow.jobs.verify.steps;
  const screenshotUpload = steps.find((step) => step.id === "storybook-golden-screenshots");
  const candidate = steps.find((step) => step.id === "storybook-golden-candidate");
  const candidateUpload = steps.find((step) => step.if?.includes("steps.storybook-golden-candidate.outcome"));
  assert.match(screenshotUpload?.if ?? "", /storybook_build_status == '0'.*storybook_qa_status == '0'/);
  assert.match(candidate?.env?.STORYBOOK_BUILD_EXIT_CODE ?? "", /runtime-gates\.outputs\.storybook_build_status/);
  assert.match(candidate?.env?.WDC_STORYBOOK_CANDIDATE_GIT_SHA ?? "", /pull_request\.head\.sha.*github\.sha/);
  assert.match(candidate?.env?.WDC_STORYBOOK_CANDIDATE_GIT_REF ?? "", /github\.head_ref.*github\.ref/);
  assert.match(candidate?.env?.WDC_STORYBOOK_RUNTIME_GIT_SHA ?? "", /github\.sha/);
  assert.match(candidate?.env?.WDC_STORYBOOK_RUNTIME_GIT_REF ?? "", /github\.ref/);
  assert.equal(candidateUpload?.if, "always() && steps.storybook-golden-candidate.outcome == 'success'");
  const evidenceUpload = steps.find((step) => step.id === "compiler-core-evidence");
  assert.match(String(evidenceUpload?.with?.path ?? ""), /artifacts\/design-quality-browser\//);
});

test("promotion refuses CI self-baselining and requires explicit admission", async () => {
  const fixture = await candidateFixture();
  const reviewPath = join(fixture.root, "review.json");
  const candidateBytes = await readFile(fixture.candidatePath);
  await writeFile(reviewPath, `${JSON.stringify({
    schema: "website-design-compiler/storybook-golden-review/v1",
    candidateSha256: sha256(candidateBytes),
    decision: "ADMIT",
    reviewer: { identity: "tech-lead", context: "separate-visual-review", independence: "SEPARATE_REVIEW_CONTEXT" },
    reviewedAt: "2026-08-18T12:00:00.000Z",
    inspectedScreenshots: Object.entries(fixture.candidate.screenshots).map(([name, screenshotSha256]) => ({
      name,
      sha256: screenshotSha256,
      observation: `Inspected ${name}`
    }))
  }, null, 2)}\n`);
  const common = {
    candidatePath: fixture.candidatePath,
    screenshotsDirectory: fixture.screenshotsDirectory,
    reviewPath,
    outputPath: join(fixture.root, "visual-goldens.json")
  };
  await assert.rejects(promoteStorybookGoldenCandidate({ ...common, admit: false, githubActions: false }), /explicit --admit-reviewed-candidate/);
  await assert.rejects(promoteStorybookGoldenCandidate({ ...common, admit: true, githubActions: true }), /cannot run inside GitHub Actions/);
  await assert.rejects(promoteStorybookGoldenCandidate({ ...common, admit: true, githubActions: false, githubRunId: 1234 }), /workflow run that produced it/);
});

test("promotion writes a review-bound v3 manifest only after all 90 hashes are inspected", async () => {
  const fixture = await candidateFixture();
  const reviewPath = join(fixture.root, "review.json");
  const outputPath = join(fixture.root, "visual-goldens.json");
  const candidateBytes = await readFile(fixture.candidatePath);
  const review = {
    schema: "website-design-compiler/storybook-golden-review/v1",
    candidateSha256: sha256(candidateBytes),
    decision: "ADMIT",
    reviewer: { identity: "tech-lead", context: "separate-visual-review", independence: "SEPARATE_REVIEW_CONTEXT" },
    reviewedAt: "2026-08-18T12:00:00.000Z",
    inspectedScreenshots: Object.entries(fixture.candidate.screenshots).map(([name, screenshotSha256]) => ({
      name,
      sha256: screenshotSha256,
      observation: `Inspected ${name}`
    }))
  };
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  const manifest = await promoteStorybookGoldenCandidate({
    candidatePath: fixture.candidatePath,
    screenshotsDirectory: fixture.screenshotsDirectory,
    reviewPath,
    outputPath,
    admit: true,
    githubActions: false
  });
  assert.equal(manifest.schema, "website-design-compiler/storybook-visual-goldens/v3");
  assert.equal(manifest.review.candidateSha256, review.candidateSha256);
  assert.equal(Object.keys(JSON.parse(manifest.candidateArtifact.document).screenshots).length, 90);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), manifest);
  await validateReviewedGoldenManifest(manifest);
});

test("promotion rejects a review whose inspected hash does not match downloaded bytes", async () => {
  const fixture = await candidateFixture();
  const reviewPath = join(fixture.root, "review.json");
  const candidateBytes = await readFile(fixture.candidatePath);
  const inspectedScreenshots = Object.entries(fixture.candidate.screenshots).map(([name, screenshotSha256]) => ({
    name,
    sha256: screenshotSha256,
    observation: `Inspected ${name}`
  }));
  inspectedScreenshots[0] = { ...inspectedScreenshots[0]!, sha256: "0".repeat(64) };
  await writeFile(reviewPath, `${JSON.stringify({
    schema: "website-design-compiler/storybook-golden-review/v1",
    candidateSha256: sha256(candidateBytes),
    decision: "ADMIT",
    reviewer: { identity: "tech-lead", context: "separate-visual-review", independence: "SEPARATE_REVIEW_CONTEXT" },
    reviewedAt: "2026-08-18T12:00:00.000Z",
    inspectedScreenshots
  }, null, 2)}\n`);
  await assert.rejects(promoteStorybookGoldenCandidate({
    candidatePath: fixture.candidatePath,
    screenshotsDirectory: fixture.screenshotsDirectory,
    reviewPath,
    outputPath: join(fixture.root, "visual-goldens.json"),
    admit: true,
    githubActions: false
  }), /review hash does not match the candidate/);
});

test("formal admission rejects legacy v2 manifests without independent review", async () => {
  const fixture = await candidateFixture();
  await assert.rejects(validateReviewedGoldenManifest({
    schema: "website-design-compiler/storybook-visual-goldens/v2",
    source: {
      gitSha: "a".repeat(40),
      workflowRun: 1234,
      artifactId: 9876,
      runnerImage: { os: "ubuntu-24.04", version: "20260810.271.1", release: "ubuntu24/20260810.271" },
      browser: { engine: "Chrome Headless Shell", version: "151.0.7922.34", playwrightPackage: "1.62.1", playwrightChromiumRevision: 1234 },
      fonts: Array.from({ length: 8 }, (_, index) => `font-${index}=1.0`),
      projects: ["storybook-desktop", "storybook-mobile"]
    },
    screenshots: fixture.candidate.screenshots
  }), /Only a reviewed Storybook visual-goldens\/v3 manifest/);
});

test("formal admission rejects a candidate without the screenshot-producing runtime Git subject", async () => {
  const fixture = await candidateFixture();
  const candidate = structuredClone(fixture.candidate) as unknown as {
    source: { runtimeGit?: { sha: string; ref: string } };
  };
  delete candidate.source.runtimeGit;
  await assert.rejects(
    validateAgainstSchema(candidate, "storybook-golden-candidate.schema.json", process.cwd()),
    /required property 'runtimeGit'/
  );
});

test("formal admission rejects an incoherent candidate and runtime Git relationship", async () => {
  const fixture = await candidateFixture();
  const candidate = structuredClone(fixture.candidate);
  candidate.source.runtimeGit.ref = candidate.source.git.ref;
  const document = `${JSON.stringify(candidate, null, 2)}\n`;
  const candidateSha256 = sha256(document);
  await assert.rejects(validateReviewedGoldenManifest({
    schema: "website-design-compiler/storybook-visual-goldens/v3",
    candidateArtifact: { sha256: candidateSha256, document },
    review: {
      schema: "website-design-compiler/storybook-golden-review/v1",
      candidateSha256,
      decision: "ADMIT",
      reviewer: { identity: "tech-lead", context: "separate-visual-review", independence: "SEPARATE_REVIEW_CONTEXT" },
      reviewedAt: "2026-08-18T12:00:00.000Z",
      inspectedScreenshots: Object.entries(candidate.screenshots).map(([name, screenshotSha256]) => ({
        name,
        sha256: screenshotSha256,
        observation: `Inspected ${name}`
      }))
    }
  }), /same ref must bind the same SHA/);
});

test("formal admission rejects a synthetic PR merge ref impersonating the durable candidate subject", async () => {
  const fixture = await candidateFixture();
  const candidate = structuredClone(fixture.candidate);
  candidate.source.git = structuredClone(candidate.source.runtimeGit);
  const document = `${JSON.stringify(candidate, null, 2)}\n`;
  const candidateSha256 = sha256(document);
  await assert.rejects(validateReviewedGoldenManifest({
    schema: "website-design-compiler/storybook-visual-goldens/v3",
    candidateArtifact: { sha256: candidateSha256, document },
    review: {
      schema: "website-design-compiler/storybook-golden-review/v1",
      candidateSha256,
      decision: "ADMIT",
      reviewer: { identity: "tech-lead", context: "separate-visual-review", independence: "SEPARATE_REVIEW_CONTEXT" },
      reviewedAt: "2026-08-18T12:00:00.000Z",
      inspectedScreenshots: Object.entries(candidate.screenshots).map(([name, screenshotSha256]) => ({
        name,
        sha256: screenshotSha256,
        observation: `Inspected ${name}`
      }))
    }
  }), /durable branch head/);
});

test("formal admission returns an explicit failure instead of leaving stale receipt evidence", async () => {
  const admission = await evaluateReviewedGoldenAdmission({
    schema: "website-design-compiler/storybook-visual-goldens/v2",
    source: {},
    screenshots: {}
  });
  assert.equal(admission.state, "FAIL");
  if (admission.state === "FAIL") assert.match(admission.error, /must match exactly one schema in oneOf/);
});

test("formal admission rejects source provenance mutated after independent review", async () => {
  const fixture = await candidateFixture();
  const reviewPath = join(fixture.root, "review.json");
  const candidateBytes = await readFile(fixture.candidatePath);
  await writeFile(reviewPath, `${JSON.stringify({
    schema: "website-design-compiler/storybook-golden-review/v1",
    candidateSha256: sha256(candidateBytes),
    decision: "ADMIT",
    reviewer: { identity: "tech-lead", context: "separate-visual-review", independence: "SEPARATE_REVIEW_CONTEXT" },
    reviewedAt: "2026-08-18T12:00:00.000Z",
    inspectedScreenshots: Object.entries(fixture.candidate.screenshots).map(([name, screenshotSha256]) => ({ name, sha256: screenshotSha256, observation: `Inspected ${name}` }))
  }, null, 2)}\n`);
  const manifest = await promoteStorybookGoldenCandidate({
    candidatePath: fixture.candidatePath,
    screenshotsDirectory: fixture.screenshotsDirectory,
    reviewPath,
    outputPath: join(fixture.root, "visual-goldens.json"),
    admit: true,
    githubActions: false
  });
  const mutatedCandidate = JSON.parse(manifest.candidateArtifact.document);
  mutatedCandidate.source.workflow.runId += 1;
  const mutatedManifest = { ...manifest, candidateArtifact: { ...manifest.candidateArtifact, document: `${JSON.stringify(mutatedCandidate, null, 2)}\n` } };
  await assert.rejects(validateReviewedGoldenManifest(mutatedManifest), /Embedded candidate bytes do not match/);
});

test("promotion rejects review text that would publish a credential or machine-private path", async () => {
  const fixture = await candidateFixture();
  const reviewPath = join(fixture.root, "review.json");
  const candidateBytes = await readFile(fixture.candidatePath);
  await writeFile(reviewPath, `${JSON.stringify({
    schema: "website-design-compiler/storybook-golden-review/v1",
    candidateSha256: sha256(candidateBytes),
    decision: "ADMIT",
    reviewer: { identity: "tech-lead", context: "/Users/reviewer/private", independence: "SEPARATE_REVIEW_CONTEXT" },
    reviewedAt: "2026-08-18T12:00:00.000Z",
    inspectedScreenshots: Object.entries(fixture.candidate.screenshots).map(([name, screenshotSha256]) => ({ name, sha256: screenshotSha256, observation: `Inspected ${name}` }))
  }, null, 2)}\n`);
  await assert.rejects(promoteStorybookGoldenCandidate({
    candidatePath: fixture.candidatePath,
    screenshotsDirectory: fixture.screenshotsDirectory,
    reviewPath,
    outputPath: join(fixture.root, "visual-goldens.json"),
    admit: true,
    githubActions: false
  }), /credentials or machine-private paths/);
});

test("failed atomic replacement cleans its temporary candidate fixture", async () => {
  const fixture = await candidateFixture();
  const reviewPath = join(fixture.root, "review.json");
  const blockedOutput = join(fixture.root, "blocked-output");
  const candidateBytes = await readFile(fixture.candidatePath);
  await mkdir(blockedOutput);
  await writeFile(reviewPath, `${JSON.stringify({
    schema: "website-design-compiler/storybook-golden-review/v1",
    candidateSha256: sha256(candidateBytes),
    decision: "ADMIT",
    reviewer: { identity: "tech-lead", context: "separate-visual-review", independence: "SEPARATE_REVIEW_CONTEXT" },
    reviewedAt: "2026-08-18T12:00:00.000Z",
    inspectedScreenshots: Object.entries(fixture.candidate.screenshots).map(([name, screenshotSha256]) => ({ name, sha256: screenshotSha256, observation: `Inspected ${name}` }))
  }, null, 2)}\n`);
  await assert.rejects(promoteStorybookGoldenCandidate({
    candidatePath: fixture.candidatePath,
    screenshotsDirectory: fixture.screenshotsDirectory,
    reviewPath,
    outputPath: blockedOutput,
    admit: true,
    githubActions: false
  }));
  assert.equal((await readdir(fixture.root)).some((name) => name.startsWith(".blocked-output.") && name.endsWith(".tmp")), false);
});
