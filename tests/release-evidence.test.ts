import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { writeDesignContracts } from "../src/design-contracts.js";
import { writeFrontendPlan } from "../src/frontend-builder.js";
import { writeGraphics2DPlan } from "../src/graphics-2d.js";
import { writeGraphics3DArtifacts } from "../src/graphics-3d.js";
import { writeMotionDirectorPlan } from "../src/motion-director.js";
import { writeReferenceIntelligenceArtifacts } from "../src/reference-intelligence.js";
import { validateCompilerInput } from "../src/validate.js";
import {
  RELEASE_CHILD_SPECS,
  RELEASE_CAPABILITY_SPECS,
  bindReleaseEvidence,
  readBoundReleaseEvidence,
  verifyCoreReleaseEvidence
} from "../src/release-evidence.js";

const git = { sha: "a".repeat(40), ref: "refs/heads/main" };
const hash = "b".repeat(64);
const minimalInputSha256 = "c34276f1658079b8444b338b5628f5cdeb168c0c8d510e43acd2f38182a60ce4";
const states = { check: "PASS" };

function validReceipts(): Record<string, Record<string, unknown>> {
  return {
    runtime: {
      schema: "website-design-compiler/runtime-receipt/v1", overall: "PASS", git,
      project: "minimal-showcase", generatedAt: "2026-08-18T00:00:00.000Z", inputSha256: minimalInputSha256,
      runtime: { node: "v22", platform: "darwin", arch: "arm64" },
      stages: [
        { stage: "reference-intelligence", state: "PASS", reason: "executed", artifacts: ["reference-intelligence/reference-manifest.json"] },
        { stage: "art-direction", state: "PASS", reason: "executed", artifacts: ["art-direction/design-read.json"] },
        { stage: "frontend-builder", state: "PASS", reason: "executed", artifacts: ["frontend-builder/frontend-plan.json"] },
        { stage: "motion-director", state: "PASS", reason: "executed", artifacts: ["motion-director/motion-plan.json"] },
        { stage: "graphics-2d", state: "PASS", reason: "executed", artifacts: ["graphics-2d/graphics-2d-plan.json"] },
        { stage: "graphics-3d", state: "PASS", reason: "executed", artifacts: ["graphics-3d/graphics-3d-plan.json"] },
        { stage: "release-receipt", state: "PASS", reason: "executed", artifacts: ["runtime-receipt.json"] }
      ]
    },
    browser: {
      schema: "website-design-compiler/browser-qa-runtime-receipt/v1", overall: "PASS", git,
      requiredProjects: ["desktop"], projectResults: [{ projectName: "desktop", status: "passed" }],
      passedProjects: ["desktop"], failedProjects: [], missingProjects: [], missingScreenshots: [],
      artifacts: { report: "playwright-report.json", runtimeReport: "playwright-runtime-report.json", screenshots: ["screenshots/desktop.png"], traces: ["desktop-trace.zip"] },
      gates: { browserMatrix: "PASS", screenshots: "PASS", traces: "PASS", playwrightReport: "PASS", playwrightRuntimeReport: "PASS" }
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
    const expectedState = key === "runtime" ? "FAIL" : "PASS";
    assert.equal(bindReleaseEvidence(receipt, spec.schema, git).state, expectedState, key);
    const hollow = { schema: spec.schema, overall: "PASS", git };
    assert.equal(bindReleaseEvidence(hollow, spec.schema, git).state, "FAIL", `${key} hollow receipt`);
  }
});

test("a formal Arena FAIL can preserve complete category coverage when compiler receipts are absent", () => {
  const arena = validReceipts().arena;
  assert.ok(arena);
  arena.overall = "FAIL";
  arena.benchmarkScore = 0;
  arena.categories = (arena.categories as Array<Record<string, unknown>>).map((category) => ({
    ...category,
    state: "FAIL",
    compilerOverall: "ABSENT",
    inputSha256: "ABSENT",
    missingStages: ["reference-intelligence"],
    stageScore: 0
  }));

  const binding = bindReleaseEvidence(arena, RELEASE_CHILD_SPECS.arena.schema, git);
  assert.equal(binding.state, "FAIL");
  assert.equal(binding.binding, "BOUND");
  assert.deepEqual(binding.errors, []);
});

test("a complete Storybook FAIL remains structurally bound when runtime screenshots and review are absent",()=>{
  const storybook=validReceipts().storybook;
  assert.ok(storybook);
  Object.assign(storybook,{overall:"FAIL",projectResults:[],missingProjects:["desktop"],screenshots:[],diagnostics:["storybook runtime is not exercised"],richSections:{expectedCount:0,storyIds:[],missingSectionScreenshots:[]},visualRegression:"FAIL",visualReview:{reviewReceiptSha256:null,reviewSubjectIsAncestor:false,independentReviewDiagnostics:["independent review is absent"],missingVisualReviews:[],unexpectedVisualReviews:[],duplicateVisualReviews:[],failedVisualReviews:[]},visualGoldens:{missingGoldenScreenshots:[],unexpectedScreenshots:[],mismatches:[],actualHashes:{}},gates:{inputDiagnostics:"FAIL",publicComponentCoverage:"PASS",statusStateMatrix:"PASS",buttonStateMatrix:"PASS",storybookBuild:"FAIL",browserProjects:"FAIL",richSectionRuntimeCoverage:"FAIL",visualReview:"FAIL",visualRegression:"FAIL"}});
  const binding=bindReleaseEvidence(storybook,RELEASE_CHILD_SPECS.storybook.schema,git);
  assert.equal(binding.state,"FAIL");
  assert.equal(binding.binding,"BOUND");
  assert.deepEqual(binding.errors,[]);
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
    if (key === "runtime") {
      const inputBytes = await readFile(resolve("fixtures/minimal/compiler-input.json"));
      const inputPath = join(root, "fixtures/minimal/compiler-input.json");
      await mkdir(dirname(inputPath), { recursive: true });
      await writeFile(inputPath, inputBytes);
      const rawInput = JSON.parse(inputBytes.toString("utf8")) as unknown;
      const input = await validateCompilerInput(rawInput);
      const outputDirectory = dirname(path);
      await writeReferenceIntelligenceArtifacts(input, outputDirectory);
      await writeDesignContracts(input, outputDirectory);
      await writeFrontendPlan(input, outputDirectory);
      await writeMotionDirectorPlan(input, outputDirectory);
      await writeGraphics2DPlan(outputDirectory);
      await writeGraphics3DArtifacts(outputDirectory);
    }
    evidenceBindings[key] = await readBoundReleaseEvidence(root, spec.path, spec.schema, git);
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

test("runtime evidence cannot pass when a claimed stage artifact is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-runtime-artifacts-"));
  try {
    await writeCoreFixture(root);
    await rm(join(root, "artifacts/runtime/minimal/frontend-builder/frontend-plan.json"));
    const result = await verifyCoreReleaseEvidence(root, git);
    assert.equal(result.state, "FAIL");
    assert.match(result.errors.join("; "), /missing or unreadable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime evidence rejects one-byte proof reuse across governed stages", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-runtime-proof-reuse-"));
  try {
    const spec = RELEASE_CHILD_SPECS.runtime;
    const path = join(root, spec.path);
    await mkdir(dirname(path), { recursive: true });
    const receipt = structuredClone(validReceipts().runtime!);
    for (const stage of receipt.stages as Array<{ artifacts: string[] }>) stage.artifacts = ["proof.bin"];
    await writeFile(join(dirname(path), "proof.bin"), "x", "utf8");
    await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    const result = await readBoundReleaseEvidence(root, spec.path, spec.schema, git);
    assert.equal(result.state, "FAIL");
    assert.match(result.errors.join("; "), /canonical artifact|reused/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime evidence binds the governed input and rejects symlinked artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-runtime-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "wdc-runtime-outside-"));
  try {
    await writeCoreFixture(root);
    const receiptPath = join(root, RELEASE_CHILD_SPECS.runtime.path);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>;
    receipt.inputSha256 = hash;
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    const inputMismatch = await readBoundReleaseEvidence(root, RELEASE_CHILD_SPECS.runtime.path, RELEASE_CHILD_SPECS.runtime.schema, git);
    assert.equal(inputMismatch.state, "FAIL");
    assert.match(inputMismatch.errors.join("; "), /inputSha256/);

    receipt.inputSha256 = minimalInputSha256;
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    const canonicalArtifact = join(root, "artifacts/runtime/minimal/frontend-builder/frontend-plan.json");
    const outsideArtifact = join(outside, "frontend-plan.json");
    await copyFile(canonicalArtifact, outsideArtifact);
    await rm(canonicalArtifact);
    await symlink(outsideArtifact, canonicalArtifact);
    const symlinked = await readBoundReleaseEvidence(root, RELEASE_CHILD_SPECS.runtime.path, RELEASE_CHILD_SPECS.runtime.schema, git);
    assert.equal(symlinked.state, "FAIL");
    assert.match(symlinked.errors.join("; "), /symbolic link|outside/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("legacy premium evidence cannot impersonate the v3 artifact-bound contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-premium-artifacts-"));
  try {
    const spec = RELEASE_CAPABILITY_SPECS.premiumQuality;
    const categories = ["b2b-product", "editorial", "premium-consumer-brand", "motion-heavy-creative", "interactive-2d", "interactive-3d"];
    const evaluations: Record<string, unknown>[] = [];
    for (const category of categories) for (const viewport of ["mobile", "desktop"] as const) {
      const project = viewport === "mobile" ? "mobile-chromium" : "desktop-chromium";
      const observationPath = `artifacts/generated-pages/observations/${project}--${category}.json`;
      const screenshotPath = `artifacts/generated-pages/screenshots/${project}--${category}.png`;
      const observation = {
        schema: "website-design-compiler/generated-page-visual-observation/v1", category, project,
        viewport: { width: 1, height: 1 }, nodeCount: 1, sectionKinds: ["navigation"],
        typography: { families: ["fixture"], headingToBodyRatio: 0, distinctHeadingSizes: 0 },
        contrast: { minimumRatio: 0, sampleCount: 0 }, rhythm: { averageVerticalGap: 0, distinctBackgrounds: 0, sectionTransitions: 0 },
        ctaCount: 0, clippedTextCount: 999
      };
      const observationBytes = Buffer.from(`${JSON.stringify(observation)}\n`);
      const screenshotBytes = Buffer.from([1]);
      await mkdir(dirname(join(root, observationPath)), { recursive: true });
      await mkdir(dirname(join(root, screenshotPath)), { recursive: true });
      await writeFile(join(root, observationPath), observationBytes);
      await writeFile(join(root, screenshotPath), screenshotBytes);
      evaluations.push({
        card: { category, viewport, score: 100, originalityAudit: { state: "PASS" } },
        binding: { schema: "website-design-compiler/design-quality-evidence/v2", category, viewport, gitSha: git.sha, pageGraphSha256: hash, designTokensSha256: hash, screenshotSha256: createHash("sha256").update(screenshotBytes).digest("hex"), graphSignature: "forged", screenshotPath },
        decision: { overall: "PREMIUM_PASS", evidenceState: "PASS", structuralState: "PASS" },
        suppliedReferenceAudit: { originalityState: "PASS", observedReferenceCount: 1 },
        source: {
          pageGraphPath: `artifacts/v2/design-quality/page-graphs/${category}.json`,
          generatedPageReceiptPath: "artifacts/generated-pages/generated-page-browser-receipt.json",
          semanticTokenReceiptPath: "artifacts/v2/semantic-design-tokens/receipt.json",
          tokenArtifactId: category,
          tokenPath: `artifacts/v2/semantic-design-tokens/${category}.json`,
          visualDirectionReceiptPath: "artifacts/v2/visual-direction-search/receipt.json",
          visualObservationPath: observationPath,
          visualObservationSha256: createHash("sha256").update(observationBytes).digest("hex")
        }
      });
    }
    const receipt = {
      schema: spec.schema, overall: "PASS", git,
      releaseProfile: { sha256: hash, requiredViewports: ["mobile", "desktop"], premiumQualityThreshold: 78, originalitySimilarityThreshold: 0.82, requireExactEvidenceBinding: true },
      categoryCount: 6, viewportCoverage: { mobile: 6, desktop: 6 }, exactHeadBound: true, allEvidenceBound: true, allStructuralPass: true, allOriginalityPass: true,
      premium: { state: "PASS", evaluations }
    };
    const profilePath = join(root, "fixtures/v2/release-profiles/premium.json");
    await mkdir(dirname(profilePath), { recursive: true });
    await copyFile(resolve("fixtures/v2/release-profiles/premium.json"), profilePath);
    assert.equal(bindReleaseEvidence(receipt, spec.schema, git).state, "FAIL");
    const path = join(root, spec.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    const result = await readBoundReleaseEvidence(root, spec.path, spec.schema, git);
    assert.equal(result.state, "FAIL");
    assert.match(result.errors.join("; "), /required property 'calibration'/);
    assert.match(result.errors.join("; "), /required property 'allMeasurementsPass'/);
    assert.match(result.errors.join("; "), /releaseProfile must have required property 'schema'/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("optional capability shells use the same strict validators as core evidence", () => {
  for (const [capability, spec] of Object.entries(RELEASE_CAPABILITY_SPECS)) {
    const shell = { schema: spec.schema, overall: "PASS", git };
    const result = bindReleaseEvidence(shell, spec.schema, git);
    assert.equal(result.state, "FAIL", capability);
    assert.ok(result.errors.length > 0, capability);
  }
});

test("formal optional capability evidence remains admissible through the centralized validators", () => {
  const liveTarget = (id: string) => ({
    targetUrl: `https://${id}.example.test/reference`, finalUrl: `https://${id}.example.test/reference`, state: "PASS", availability: "AVAILABLE",
    httpStatus: 200, contentType: "text/html", responseBytes: 128, responseSha256: hash, artifactIdentity: `sha256:${hash}`,
    capturedAt: "2026-08-18T00:00:01.000Z", dnsResolutions: [{ attempt: 1, hostname: `${id}.example.test`, addresses: ["203.0.113.10"], observedAt: "2026-08-18T00:00:00.000Z" }],
    redirectChain: [], connectedAddress: "203.0.113.10", attemptCount: 1, observations: ["captured"], implementationDetails: "UNKNOWN", drift: "BASELINE"
  });
  const live = {
    schema: RELEASE_CAPABILITY_SPECS.liveReference.schema, overall: "PASS", git, executionMode: "LIVE", transportMode: "PRODUCTION",
    approval: { id: "human-admit-1", approvedAt: "2026-08-18T00:00:00.000Z", targetCount: 2 },
    policy: { minimumDistinctHttpsTargets: 2, timeoutMs: 1000, maxAttempts: 2, retryBackoffMs: 10, maxRedirects: 2, maxBytes: 1024 },
    targets: [liveTarget("first"), liveTarget("second")], promotionBlockedReason: null
  };
  const webgpu = {
    schema: RELEASE_CAPABILITY_SPECS.webgpu.schema, overall: "PASS", git, rendererOutcome: "WEBGPU_PASS",
    selected: { state: "WEBGPU_PASS", renderer: "webgpu", reason: "browser execution", capabilities: { webgpu: true, webgl: true }, runtime: { state: "WEBGPU_PASS", identity: { adapter: "navigator.gpu", renderer: "three.WebGPURenderer", rendererVersion: "0.184.0", tslModule: "three/tsl@0.184.0", adapterInfo: { state: "REPORTED", sha256: hash }, features: [], limits: { maxTextureDimension2D: 8192, maxBindGroups: 4, maxBufferSize: 268435456 } }, budget: { dpr: 1, drawCalls: 1, triangles: 1, textureBytes: 1, framesRendered: 1, frameLoop: "demand" } } },
    fallbacks: { initializationFailure: "PASS", totalGpuFailure: "PASS", deviceLoss: "PASS" }
  };
  const productionProvider = {
    schema: RELEASE_CAPABILITY_SPECS.productionProvider.schema, gate: "PRODUCTION_PROVIDER", overall: "NOT_EXERCISED", admissionState: "NEEDS_HUMAN_ADMIT", productionReleaseEligible: false,
    providerIdentity: "ABSENT", modelIdentity: "ABSENT", rightsClearance: "ABSENT", runtimeCredentials: "ABSENT", budgetAuthorization: "ABSENT", deterministicMockGate: "SEPARATE",
    executionReceiptSha256:"ABSENT",requestSha256:"ABSENT",assetSha256:"ABSENT",reason: "human admission is absent", git
  };
  assert.equal(bindReleaseEvidence(live, RELEASE_CAPABILITY_SPECS.liveReference.schema, git).state, "PASS");
  assert.equal(bindReleaseEvidence(webgpu, RELEASE_CAPABILITY_SPECS.webgpu.schema, git).state, "PASS");
  assert.equal(bindReleaseEvidence(productionProvider, RELEASE_CAPABILITY_SPECS.productionProvider.schema, git).state, "NOT_EXERCISED");
});
