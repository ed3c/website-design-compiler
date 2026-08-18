import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  RELEASE_CHILD_SPECS,
  bindReleaseEvidence,
  readBoundReleaseEvidence,
  verifyCoreReleaseEvidence
} from "../src/release-evidence.js";

const git = { sha: "a".repeat(40), ref: "refs/heads/main" };
const hash = "b".repeat(64);
const states = { check: "PASS" };

function validReceipts(): Record<string, Record<string, unknown>> {
  return {
    runtime: {
      schema: "website-design-compiler/runtime-receipt/v1", overall: "PASS", git,
      project: "fixture", generatedAt: "2026-08-18T00:00:00.000Z", inputSha256: hash,
      runtime: { node: "v22", platform: "darwin", arch: "arm64" },
      stages: [{ stage: "release-receipt", state: "PASS", reason: "executed", artifacts: ["runtime-receipt.json"] }]
    },
    browser: {
      schema: "website-design-compiler/browser-qa-runtime-receipt/v1", overall: "PASS", git,
      requiredProjects: ["desktop"], projectResults: [{ projectName: "desktop", status: "passed" }],
      passedProjects: ["desktop"], failedProjects: [], missingProjects: [], missingScreenshots: [],
      artifacts: { report: "playwright-report.json", screenshots: ["screenshots/desktop.png"], traces: ["desktop-trace.zip"] },
      gates: { browserMatrix: "PASS", screenshots: "PASS", traces: "PASS", playwrightReport: "PASS" }
    },
    quality: {
      schema: "website-design-compiler/accessibility-performance-receipt/v1", overall: "PASS", git,
      configuration: { path: "policies/release-budgets.json", schema: "website-design-compiler/release-budgets/v1", version: 1, sha256: hash, exceptions: [] },
      requiredProjects: ["desktop"], missingProjects: [], failedProjects: [],
      projects: [{ schema: "website-design-compiler/accessibility-performance-project/v1", project: "desktop", overall: "PASS", gates: states }]
    },
    storybook: {
      schema: "website-design-compiler/storybook-workshop-receipt/v1", overall: "PASS", git,
      publicComponents: ["Button"], storyComponents: ["Button"], missingStories: [], requiredStates: ["success"], missingStatusStates: [],
      requiredButtonStories: ["Primary"], missingButtonStates: [], requiredProjects: ["desktop"],
      projectResults: [{ projectName: "desktop", status: "passed" }], failedProjects: [], missingProjects: [], screenshots: ["desktop--button.png"],
      duplicateScreenshotNames: [], reviewedSourceRoots: ["apps/site"], sourceFilesSha256: hash, screenshotSetSha256: hash, diagnostics: [],
      richSections: { expectedCount: 1, storyIds: ["button"], missingSectionScreenshots: [] }, visualRegression: "PASS",
      visualReview: { reviewReceiptSha256: hash, reviewSubjectIsAncestor: true, independentReviewDiagnostics: [], missingVisualReviews: [], unexpectedVisualReviews: [], duplicateVisualReviews: [], failedVisualReviews: [] },
      visualGoldens: { missingGoldenScreenshots: [], unexpectedScreenshots: [], mismatches: [], actualHashes: { "desktop--button.png": hash } },
      gates: { inputDiagnostics: "PASS", publicComponentCoverage: "PASS", statusStateMatrix: "PASS", buttonStateMatrix: "PASS", storybookBuild: "PASS", browserProjects: "PASS", richSectionRuntimeCoverage: "PASS", visualReview: "PASS", visualRegression: "PASS" }
    },
    shared: {
      schema: "website-design-compiler/shared-binding-receipt/v1", overall: "PASS", git,
      sourceRepository: "ed3c/skills-shared", sourceIdentity: "fixture", consumerIdentity: `git:${git.sha}`,
      resolutions: [{ name: "repo-agent-native", optional: false, state: "PASS", identity: "fixture@1" }]
    },
    arena: {
      schema: "website-design-compiler/arena-score/v1", overall: "PASS", git,
      categoryCoverage: "PASS", benchmarkScore: 100,
      categories: ["b2b-product", "editorial", "premium-consumer-brand", "motion-heavy-creative", "interactive-2d", "interactive-3d"].map((id) => ({ id, state: "PASS", compilerOverall: "PASS", inputSha256: hash, missingStages: [], nonPassStages: [], stageScore: 100 })),
      globalEvidence: { browserMatrix: "PASS" }, missingGlobalEvidence: [], nonPassGlobalEvidence: []
    },
    showcase: {
      schema: "website-design-compiler/showcase-compiler-receipt/v1", overall: "PASS", git,
      fixture: "fixtures/showcase/compiler-input.json", runtimeReceipt: "artifacts/showcase/compiler/runtime-receipt.json",
      stageStates: { "release-receipt": "PASS" }, requiredArtifacts: ["runtime-receipt.json"], missingArtifacts: [],
      projection: { checkedIn: "apps/site/generated/showcase-frontend-plan.json", generated: "artifacts/showcase/compiler/frontend-builder/frontend-plan.json", matchesCompiler: true },
      route: "/showcase", fallbackQuery: "?graphics=off&graphics3d=off"
    },
    external: {
      schema: "website-design-compiler/external-skill-registry-admission-receipt/v1", overall: "PASS", git,
      registry: ".skill-bindings/external-design-skills.json", upstreamEvidence: "fixtures/external-skills/upstream-evidence.json",
      upstreamVerifiedAt: "2026-08-18T00:00:00.000Z", verificationMode: "github-api-exact-commit-metadata", mode: "reference-only-no-vendoring",
      primaryArtDirector: "repo-native", enabledCount: 1, capabilitySlots: { "art-direction": "PASS" }, admittedCapabilities: ["art-direction"],
      evalsRequiredOnIdentityChange: ["art-direction"], registryResolutions: [{ id: "fixture", state: "PASS", identity: "git:fixture" }],
      evidenceChecks: [{ id: "fixture", state: "PASS" }], vendoredBodies: "ABSENT"
    },
    media: {
      schema: "website-design-compiler/media-generation-receipt/v1", overall: "PASS", git,
      gate: "DETERMINISTIC_MOCK", productionReleaseEligible: false, requestId: "fixture", requestSha256: hash, promptSha256: hash,
      model: { id: "mock", kind: "image", adapter: "mock", admission: "ALLOW", versionOrCommit: "v1", provenanceSubjectId: "model:mock", outputTermsSubjectId: "terms:mock" },
      parameters: { seed: 1 }, optimization: { target: "web", maxBytes: 1024 }, queue: { maxAttempts: 2, attempts: 1, cancellation: "SUPPORTED" },
      asset: { sha256: hash, bytes: 10, mediaType: "image/svg+xml", extension: "svg" }, productCoreForbiddenImports: ["WanGP"],
      workerIsolation: { diffusersImage: "BOUNDARY_ONLY", diffusersVideo: "BOUNDARY_ONLY", threeDWorker: "BOUNDARY_ONLY", wanGpProductCoreImport: "ABSENT" }
    },
    authoring: {
      schema: "website-design-compiler/authoring-receipt/v1", overall: "PASS", git,
      library: { name: "@puckeditor/core", version: "0.22.4" }, source: { frontendPlan: "frontend.json", authoringData: "authoring.json" },
      ownership: { schemaOwner: "src/puck-authoring.ts", componentRegistry: ["ButtonBlock"], productionComponents: ["Button"], arbitraryHtml: "FORBIDDEN", arbitraryCssProps: "FORBIDDEN", rawDesignValues: "FORBIDDEN" },
      composition: { deprecatedDropZoneUsed: false, slotFieldUsed: true, sectionAllow: ["ButtonBlock"], recursiveSection: "FORBIDDEN" },
      routes: { editor: "/studio", renderer: "/studio/render", invalidFixture: "/studio/render?fixture=invalid" },
      validation: { overall: "PASS", errors: [] }, projectionMatchesCompilerFrontendPlan: true, compilerImportRoundTrip: true,
      publishedPersistence: "LOCAL_STORAGE_FIXTURE_ONLY", cmsPersistence: "NOT_IMPLEMENTED"
    },
    cms: {
      schema: "website-design-compiler/payload-cms-receipt/v2", overall: "PASS", git,
      payload: { version: "3.86.0", adapter: "@payloadcms/db-sqlite", database: "EPHEMERAL_ARTIFACT", secretSource: "RUNTIME_RANDOM_ONLY", ciSchemaSync: "DEVELOPMENT_PUSH", productionSchemaSync: "MIGRATIONS_REQUIRED", productionCredentialSource: "ENVIRONMENT_ONLY" },
      ownership: { compilerSchema: "website-design-compiler/frontend-plan/v1", authoringSchema: "website-design-compiler/governed-authoring/v1", payloadCollection: "pages", compiledPageGraphCollection: "compiled-pages", productionRegistryProjection: "apps/site/generated/payload-published-authoring-data.json" },
      checks: { sourceValidation: "PASS", publishedStatus: "published", draftStatus: "draft", draftPublishedDistinguishable: true, publishedProjectionMatchesSource: true, draftProjectionValid: true, versionCountAtLeastTwo: true, guestCanReadPublished: true, guestCannotReadMediaMetadata: true, guestCannotReadLatestDraft: true, mediaProvenanceLinked: true, localizationReady: true, secretPersistedInReceipt: false, productionCredentialInSource: false, compiledPageGraphCountSix: true, compiledPageGraphFingerprintsMatch: true, compiledPageGraphsRenderThroughPuckRegistry: true, compiledDraftPublishedDistinguishable: true, guestCannotReadCompiledDraft: true },
      compiledPageGraphs: Array.from({ length: 6 }, (_, index) => ({ category: `fixture-${index}`, fingerprint: hash, declaredFingerprint: hash, restoredFingerprint: hash, puckState: "PASS" })),
      evidence: { database: "artifacts/cms/payload.sqlite", mediaReceipt: "artifacts/media-generator/media-generation-receipt.json", publishedAuthoringFixture: "apps/site/generated/payload-published-authoring-data.json" }
    },
    rights: {
      schema: "website-design-compiler/repository-rights-clearance/v2", overall: "PASS", git, generatedAt: "2026-08-18T00:00:00.000Z",
      subjects: [{ id: "model:fixture", kind: "model", name: "fixture", versionOrIdentity: "v1", licenseExpression: "REPO_ORIGINAL", state: "ALLOW", evidence: ["src/media-router.ts"], attributionRequired: false, distributed: true }],
      counts: { ALLOW: 1, REVIEW_REQUIRED: 0, DENY: 0, UNKNOWN: 0, NOT_DISTRIBUTED: 0 }, unresolved: [], expiredWaivers: [], noticeSubjects: [],
      legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE"
    }
  };
}

test("all twelve release child schemas require and accept their formal receipt structure", () => {
  const receipts = validReceipts();
  assert.deepEqual(Object.keys(RELEASE_CHILD_SPECS), Object.keys(receipts));
  for (const [key, spec] of Object.entries(RELEASE_CHILD_SPECS)) {
    const receipt = receipts[key];
    assert.equal(bindReleaseEvidence(receipt, spec.schema, git).state, "PASS", key);
    const hollow = { schema: spec.schema, overall: "PASS", git };
    assert.equal(bindReleaseEvidence(hollow, spec.schema, git).state, "FAIL", `${key} hollow receipt`);
  }
});

test("receipt binding requires the exact SHA and ref", () => {
  const receipt = validReceipts().runtime;
  assert.equal(bindReleaseEvidence(receipt, RELEASE_CHILD_SPECS.runtime.schema, { ...git, sha: "c".repeat(40) }).binding, "MISMATCH");
  assert.equal(bindReleaseEvidence(receipt, RELEASE_CHILD_SPECS.runtime.schema, { ...git, ref: "refs/heads/other" }).binding, "MISMATCH");
});

test("missing and malformed child JSON both fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-child-read-"));
  try {
    const spec = RELEASE_CHILD_SPECS.runtime;
    assert.equal((await readBoundReleaseEvidence(root, spec.path, spec.schema, git)).state, "FAIL");
    const path = join(root, spec.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{", "utf8");
    const malformed = await readBoundReleaseEvidence(root, spec.path, spec.schema, git);
    assert.equal(malformed.state, "FAIL");
    assert.match(malformed.errors.join("; "), /malformed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeCoreFixture(root: string): Promise<Record<string, unknown>> {
  const receipts = validReceipts();
  const evidenceBindings: Record<string, unknown> = {};
  const gates: Record<string, unknown> = {};
  const evidence: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(RELEASE_CHILD_SPECS)) {
    const path = join(root, spec.path);
    await mkdir(dirname(path), { recursive: true });
    const bytes = `${JSON.stringify(receipts[key], null, 2)}\n`;
    await writeFile(path, bytes, "utf8");
    evidenceBindings[key] = { ...bindReleaseEvidence(receipts[key], spec.schema, git), path: spec.path, sha256: createHash("sha256").update(bytes).digest("hex") };
    gates[spec.gate] = "PASS";
    evidence[spec.gate] = spec.path;
  }
  const umbrella = {
    schema: "website-design-compiler/release-gate-receipt/v2", overall: "PASS",
    git: { ...git, event: "push", changedFiles: [] }, workflow: { name: "fixture", runId: "1", runAttempt: "1", job: "release", commands: ["pnpm test"] },
    environment: { node: "v22", pnpm: "10", playwright: "1", platform: "darwin", osRelease: "fixture", arch: "arm64", runnerOs: "macOS", runnerArch: "ARM64", imageOs: "fixture", imageVersion: "1" },
    bindings: { sourceRepository: "ed3c/skills-shared", sourceIdentity: "fixture", consumerIdentity: `git:${git.sha}`, resolutions: [] },
    gates, evidence, evidenceBindings, optionalEvidence: {}, unresolvedRisks: []
  };
  const path = join(root, "artifacts/release/release-gate-receipt.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(umbrella, null, 2)}\n`, "utf8");
  return umbrella;
}

test("core verification re-reads all children and rejects changed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-core-release-"));
  try {
    await writeCoreFixture(root);
    assert.equal((await verifyCoreReleaseEvidence(root, git)).state, "PASS");
    const childPath = join(root, RELEASE_CHILD_SPECS.runtime.path);
    await writeFile(childPath, `${await readFile(childPath, "utf8")}\n`, "utf8");
    const result = await verifyCoreReleaseEvidence(root, git);
    assert.equal(result.state, "FAIL");
    assert.match(result.errors.join("; "), /sha256/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core verification rejects a forged binding around a structurally hollow child", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-core-release-"));
  try {
    const umbrella = await writeCoreFixture(root);
    const spec = RELEASE_CHILD_SPECS.browser;
    const hollow = { schema: spec.schema, overall: "PASS", git };
    const bytes = `${JSON.stringify(hollow, null, 2)}\n`;
    await writeFile(join(root, spec.path), bytes, "utf8");
    const bindings = umbrella.evidenceBindings as Record<string, Record<string, unknown>>;
    bindings.browser = { state: "PASS", binding: "BOUND", schema: spec.schema, git, errors: [], path: spec.path, sha256: createHash("sha256").update(bytes).digest("hex") };
    await writeFile(join(root, "artifacts/release/release-gate-receipt.json"), `${JSON.stringify(umbrella, null, 2)}\n`, "utf8");
    const result = await verifyCoreReleaseEvidence(root, git);
    assert.equal(result.state, "FAIL");
    assert.match(result.errors.join("; "), /browser/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
