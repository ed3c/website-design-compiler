import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type ReleaseInputState = "PASS" | "FAIL" | "NOT_IMPLEMENTED" | "NOT_EXERCISED" | "ABSENT" | "SKIPPED_BY_POLICY";

export interface ReleaseEvidenceBinding {
  state: ReleaseInputState;
  binding: "BOUND" | "MISMATCH" | "ABSENT";
  schema: string | null;
  git: { sha: string; ref: string } | null;
  errors: string[];
}

type JsonRecord = Record<string, unknown>;

const EVIDENCE_STATES = new Set<unknown>(["PASS", "FAIL", "ABSENT", "NOT_IMPLEMENTED", "NOT_EXERCISED", "SKIPPED_BY_POLICY"]);
const PASS_FAIL = new Set<unknown>(["PASS", "FAIL"]);
const GIT_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RIGHTS_STATES = ["ALLOW", "REVIEW_REQUIRED", "DENY", "UNKNOWN", "NOT_DISTRIBUTED"] as const;

export const RELEASE_CHILD_SPECS = {
  runtime: { gate: "runtime", path: "artifacts/runtime/minimal/runtime-receipt.json", schema: "website-design-compiler/runtime-receipt/v1" },
  browser: { gate: "browser", path: "artifacts/browser-qa/browser-qa.json", schema: "website-design-compiler/browser-qa-runtime-receipt/v1" },
  quality: { gate: "accessibilityPerformance", path: "artifacts/accessibility-performance/accessibility-performance.json", schema: "website-design-compiler/accessibility-performance-receipt/v1" },
  storybook: { gate: "storybook", path: "artifacts/storybook/storybook-workshop.json", schema: "website-design-compiler/storybook-workshop-receipt/v1" },
  shared: { gate: "sharedBindings", path: "artifacts/runtime/shared-binding-receipt.json", schema: "website-design-compiler/shared-binding-receipt/v1" },
  arena: { gate: "arena", path: "artifacts/arena/arena-score.json", schema: "website-design-compiler/arena-score/v1" },
  showcase: { gate: "showcase", path: "artifacts/showcase/showcase-compiler-receipt.json", schema: "website-design-compiler/showcase-compiler-receipt/v1" },
  external: { gate: "externalSkills", path: "artifacts/external-skills/registry-receipt.json", schema: "website-design-compiler/external-skill-registry-admission-receipt/v1" },
  media: { gate: "mediaGenerator", path: "artifacts/media-generator/media-generation-receipt.json", schema: "website-design-compiler/media-generation-receipt/v1" },
  authoring: { gate: "authoringStudio", path: "artifacts/authoring/authoring-receipt.json", schema: "website-design-compiler/authoring-receipt/v1" },
  cms: { gate: "payloadCms", path: "artifacts/cms/payload-cms-receipt.json", schema: "website-design-compiler/payload-cms-receipt/v2" },
  rights: { gate: "repositoryRights", path: "artifacts/rights-clearance/repository-rights-clearance.json", schema: "website-design-compiler/repository-rights-clearance/v2" }
} as const;

export type ReleaseChildName = keyof typeof RELEASE_CHILD_SPECS;

export interface ReleaseEvidenceFileBinding extends ReleaseEvidenceBinding {
  path: string;
  sha256: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown, nonEmpty = false): value is string[] {
  return Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every((entry) => typeof entry === "string");
}

function requireString(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${label} must be non-empty text`);
}

function requireStringArray(value: unknown, label: string, errors: string[], nonEmpty = false): void {
  if (!isStringArray(value, nonEmpty)) errors.push(`${label} must be ${nonEmpty ? "a non-empty array of" : "an array of"} text values`);
}

function requireRecord(value: unknown, label: string, errors: string[]): JsonRecord | null {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  return value;
}

function validateStateRecord(value: unknown, keys: readonly string[], label: string, errors: string[]): JsonRecord | null {
  const record = requireRecord(value, label, errors);
  if (!record) return null;
  for (const key of keys) if (!EVIDENCE_STATES.has(record[key])) errors.push(`${label}.${key} is invalid`);
  return record;
}

function validatePassFailRecord(value: unknown, keys: readonly string[], label: string, errors: string[]): JsonRecord | null {
  const record = requireRecord(value, label, errors);
  if (!record) return null;
  for (const key of keys) if (!PASS_FAIL.has(record[key])) errors.push(`${label}.${key} must be PASS or FAIL`);
  return record;
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length && actual.every((entry) => expected.includes(entry));
}

function validateRuntimeReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  if (typeof value.project !== "string" || value.project.length === 0) errors.push("project must be non-empty text");
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) errors.push("generatedAt must be an ISO timestamp");
  if (typeof value.inputSha256 !== "string" || !SHA256.test(value.inputSha256)) errors.push("inputSha256 must be a SHA-256 digest");
  const runtime = isRecord(value.runtime) ? value.runtime : null;
  if (!runtime || !["node", "platform", "arch"].every((key) => typeof runtime[key] === "string" && String(runtime[key]).length > 0)) {
    errors.push("runtime must identify node, platform, and arch");
  }
  if (!Array.isArray(value.stages) || value.stages.length === 0) {
    errors.push("stages must be a non-empty array");
    return errors;
  }
  const states: unknown[] = [];
  const names = new Set<string>();
  value.stages.forEach((stage, index) => {
    if (!isRecord(stage)) {
      errors.push(`stages[${index}] must be an object`);
      return;
    }
    if (typeof stage.stage !== "string" || stage.stage.length === 0) errors.push(`stages[${index}].stage must be non-empty text`);
    else if (names.has(stage.stage)) errors.push(`stages[${index}].stage is duplicated`);
    else names.add(stage.stage);
    if (!EVIDENCE_STATES.has(stage.state)) errors.push(`stages[${index}].state is invalid`);
    else states.push(stage.state);
    if (typeof stage.reason !== "string" || stage.reason.length === 0) errors.push(`stages[${index}].reason must be non-empty text`);
    if (!Array.isArray(stage.artifacts) || !stage.artifacts.every((entry) => typeof entry === "string")) errors.push(`stages[${index}].artifacts must be text paths`);
  });
  const derived = states.includes("FAIL") ? "FAIL"
    : states.includes("NOT_IMPLEMENTED") ? "NOT_IMPLEMENTED"
      : states.includes("ABSENT") ? "ABSENT"
        : states.includes("NOT_EXERCISED") ? "NOT_EXERCISED"
          : states.every((state) => state === "SKIPPED_BY_POLICY") ? "SKIPPED_BY_POLICY"
            : "PASS";
  if (value.overall !== derived) errors.push(`overall is inconsistent with stages; expected ${derived}`);
  return errors;
}

function validateBrowserReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  requireStringArray(value.requiredProjects, "requiredProjects", errors, true);
  requireStringArray(value.passedProjects, "passedProjects", errors);
  requireStringArray(value.failedProjects, "failedProjects", errors);
  requireStringArray(value.missingProjects, "missingProjects", errors);
  requireStringArray(value.missingScreenshots, "missingScreenshots", errors);
  if (!Array.isArray(value.projectResults) || !value.projectResults.every((entry) => isRecord(entry) && typeof entry.projectName === "string" && ["passed", "failed", "skipped", "unknown"].includes(String(entry.status)))) errors.push("projectResults must contain named browser results");
  const artifacts = requireRecord(value.artifacts, "artifacts", errors);
  if (artifacts) {
    if (artifacts.report !== null && typeof artifacts.report !== "string") errors.push("artifacts.report must be a path or null");
    requireStringArray(artifacts.screenshots, "artifacts.screenshots", errors);
    requireStringArray(artifacts.traces, "artifacts.traces", errors);
  }
  const gates = validatePassFailRecord(value.gates, ["browserMatrix", "screenshots", "traces", "playwrightReport"], "gates", errors);
  if (gates && Array.isArray(value.requiredProjects) && Array.isArray(value.passedProjects) && Array.isArray(value.failedProjects) && Array.isArray(value.missingProjects) && Array.isArray(value.missingScreenshots) && artifacts) {
    const passedProjects = value.passedProjects;
    const observedPassed = Array.isArray(value.projectResults) ? value.projectResults.filter((entry) => isRecord(entry) && entry.status === "passed").map((entry) => String((entry as JsonRecord).projectName)) : [];
    const observedFailed = Array.isArray(value.projectResults) ? value.projectResults.filter((entry) => isRecord(entry) && entry.status === "failed").map((entry) => String((entry as JsonRecord).projectName)) : [];
    const observedMissing = value.requiredProjects.filter((project) => !observedPassed.includes(String(project))).map(String);
    const observedMissingScreenshots = value.requiredProjects.filter((project) => !Array.isArray(artifacts.screenshots) || !artifacts.screenshots.includes(`screenshots/${String(project)}.png`)).map(String);
    if (!sameMembers(value.passedProjects.map(String), observedPassed)) errors.push("passedProjects is inconsistent with projectResults");
    if (!sameMembers(value.failedProjects.map(String), observedFailed)) errors.push("failedProjects is inconsistent with projectResults");
    if (!sameMembers(value.missingProjects.map(String), observedMissing)) errors.push("missingProjects is inconsistent with projectResults");
    if (!sameMembers(value.missingScreenshots.map(String), observedMissingScreenshots)) errors.push("missingScreenshots is inconsistent with screenshot artifacts");
    const expected = {
      browserMatrix: value.missingProjects.length === 0 && value.failedProjects.length === 0 && value.requiredProjects.every((project) => passedProjects.includes(project)) ? "PASS" : "FAIL",
      screenshots: value.missingScreenshots.length === 0 ? "PASS" : "FAIL",
      traces: Array.isArray(artifacts.traces) && artifacts.traces.length >= value.requiredProjects.length ? "PASS" : "FAIL",
      playwrightReport: typeof artifacts.report === "string" && artifacts.report.length > 0 ? "PASS" : "FAIL"
    };
    for (const [key, state] of Object.entries(expected)) if (gates[key] !== state) errors.push(`gates.${key} is inconsistent; expected ${state}`);
  }
  if (gates && value.overall !== (Object.values(gates).every((state) => state === "PASS") ? "PASS" : "FAIL")) errors.push("overall is inconsistent with browser gates");
  return errors;
}

function validateQualityReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  const configuration = requireRecord(value.configuration, "configuration", errors);
  if (configuration) {
    if (configuration.path !== "policies/release-budgets.json") errors.push("configuration.path must identify the release budget policy");
    requireString(configuration.schema, "configuration.schema", errors);
    if (!Number.isInteger(configuration.version) || Number(configuration.version) < 1) errors.push("configuration.version must be a positive integer");
    if (typeof configuration.sha256 !== "string" || !SHA256.test(configuration.sha256)) errors.push("configuration.sha256 must be a SHA-256 digest");
    if (!Array.isArray(configuration.exceptions)) errors.push("configuration.exceptions must be an array");
  }
  requireStringArray(value.requiredProjects, "requiredProjects", errors, true);
  requireStringArray(value.missingProjects, "missingProjects", errors);
  requireStringArray(value.failedProjects, "failedProjects", errors);
  if (!Array.isArray(value.projects)) errors.push("projects must be an array");
  else value.projects.forEach((project, index) => {
    if (!isRecord(project) || project.schema !== "website-design-compiler/accessibility-performance-project/v1" || typeof project.project !== "string" || !PASS_FAIL.has(project.overall) || !isRecord(project.gates) || Object.keys(project.gates).length === 0 || !Object.values(project.gates).every((state) => state === "PASS" || state === "FAIL" || state === "NOT_EXERCISED")) errors.push(`projects[${index}] is malformed`);
    else if (project.overall !== (Object.values(project.gates).some((state) => state === "FAIL") ? "FAIL" : "PASS")) errors.push(`projects[${index}].overall is inconsistent with its gates`);
  });
  if (Array.isArray(value.requiredProjects) && Array.isArray(value.missingProjects) && Array.isArray(value.failedProjects) && Array.isArray(value.projects)) {
    const observedNames = value.projects.filter(isRecord).map((project) => String(project.project));
    const observedFailed = value.projects.filter((project) => isRecord(project) && project.overall !== "PASS").map((project) => String((project as JsonRecord).project));
    const observedMissing = value.requiredProjects.map(String).filter((project) => !observedNames.includes(project));
    if (!sameMembers(value.failedProjects.map(String), observedFailed)) errors.push("failedProjects is inconsistent with projects");
    if (!sameMembers(value.missingProjects.map(String), observedMissing)) errors.push("missingProjects is inconsistent with projects");
    const expected = value.missingProjects.length === 0 && value.failedProjects.length === 0 && value.projects.length === value.requiredProjects.length ? "PASS" : "FAIL";
    if (value.overall !== expected) errors.push(`overall is inconsistent with project evidence; expected ${expected}`);
  }
  return errors;
}

function validateStorybookReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  for (const key of ["publicComponents", "storyComponents", "requiredStates", "requiredButtonStories", "requiredProjects", "screenshots", "reviewedSourceRoots"] as const) requireStringArray(value[key], key, errors, true);
  for (const key of ["missingStories", "missingStatusStates", "missingButtonStates", "failedProjects", "missingProjects", "duplicateScreenshotNames", "diagnostics"] as const) requireStringArray(value[key], key, errors);
  if (!Array.isArray(value.projectResults)) errors.push("projectResults must be an array");
  if (typeof value.sourceFilesSha256 !== "string" || !SHA256.test(value.sourceFilesSha256)) errors.push("sourceFilesSha256 must be a SHA-256 digest");
  if (typeof value.screenshotSetSha256 !== "string" || !SHA256.test(value.screenshotSetSha256)) errors.push("screenshotSetSha256 must be a SHA-256 digest");
  const richSections = requireRecord(value.richSections, "richSections", errors);
  if (richSections && (!Number.isInteger(richSections.expectedCount) || Number(richSections.expectedCount) < 1 || !isStringArray(richSections.storyIds, true) || !isStringArray(richSections.missingSectionScreenshots))) errors.push("richSections is malformed");
  if (value.visualRegression !== "PASS" && value.visualRegression !== "FAIL") errors.push("visualRegression must be PASS or FAIL");
  for (const key of ["visualReview", "visualGoldens"] as const) if (!isRecord(value[key])) errors.push(`${key} must contain retained evidence`);
  const visualReview = isRecord(value.visualReview) ? value.visualReview : null;
  const gates = validatePassFailRecord(value.gates, ["inputDiagnostics", "publicComponentCoverage", "statusStateMatrix", "buttonStateMatrix", "storybookBuild", "browserProjects", "richSectionRuntimeCoverage", "visualReview", "visualRegression"], "gates", errors);
  if (gates) {
    const expected: Record<string, "PASS" | "FAIL"> = {
      inputDiagnostics: Array.isArray(value.diagnostics) && value.diagnostics.length === 0 ? "PASS" : "FAIL",
      publicComponentCoverage: Array.isArray(value.missingStories) && value.missingStories.length === 0 ? "PASS" : "FAIL",
      statusStateMatrix: Array.isArray(value.missingStatusStates) && value.missingStatusStates.length === 0 ? "PASS" : "FAIL",
      buttonStateMatrix: Array.isArray(value.missingButtonStates) && value.missingButtonStates.length === 0 ? "PASS" : "FAIL",
      browserProjects: Array.isArray(value.missingProjects) && value.missingProjects.length === 0 && Array.isArray(value.failedProjects) && value.failedProjects.length === 0 ? "PASS" : "FAIL",
      richSectionRuntimeCoverage: richSections && Array.isArray(richSections.storyIds) && richSections.expectedCount === richSections.storyIds.length && Array.isArray(richSections.missingSectionScreenshots) && richSections.missingSectionScreenshots.length === 0 ? "PASS" : "FAIL",
      visualReview: visualReview && ["independentReviewDiagnostics", "missingVisualReviews", "unexpectedVisualReviews", "duplicateVisualReviews", "failedVisualReviews"].every((key) => Array.isArray(visualReview[key]) && visualReview[key].length === 0) ? "PASS" : "FAIL"
    };
    for (const [key, state] of Object.entries(expected)) if (gates[key] !== state) errors.push(`gates.${key} is inconsistent; expected ${state}`);
  }
  if (gates && value.visualRegression !== gates.visualRegression) errors.push("visualRegression is inconsistent with gates.visualRegression");
  if (gates && value.overall !== (Object.values(gates).every((state) => state === "PASS") ? "PASS" : "FAIL")) errors.push("overall is inconsistent with Storybook gates");
  return errors;
}

function validateSharedBindingReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  requireString(value.sourceRepository, "sourceRepository", errors);
  requireString(value.sourceIdentity, "sourceIdentity", errors);
  requireString(value.consumerIdentity, "consumerIdentity", errors);
  if (!Array.isArray(value.resolutions) || value.resolutions.length === 0) errors.push("resolutions must be a non-empty array");
  else value.resolutions.forEach((resolution, index) => {
    if (!isRecord(resolution) || typeof resolution.name !== "string" || typeof resolution.optional !== "boolean" || !["PASS", "FAIL", "ABSENT"].includes(String(resolution.state)) || (resolution.state === "PASS" && typeof resolution.identity !== "string")) errors.push(`resolutions[${index}] is malformed`);
    else if (resolution.state === "ABSENT" && resolution.optional !== true) errors.push(`resolutions[${index}] cannot mark a required binding ABSENT`);
  });
  if (Array.isArray(value.resolutions)) {
    const expected = value.resolutions.some((resolution) => isRecord(resolution) && (resolution.state === "FAIL" || (resolution.state === "ABSENT" && resolution.optional !== true))) ? "FAIL" : "PASS";
    if (value.overall !== expected) errors.push(`overall is inconsistent with binding resolutions; expected ${expected}`);
  }
  return errors;
}

function validateArenaReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  const expectedCategories = ["b2b-product", "editorial", "premium-consumer-brand", "motion-heavy-creative", "interactive-2d", "interactive-3d"];
  if (value.categoryCoverage !== "PASS" && value.categoryCoverage !== "FAIL") errors.push("categoryCoverage must be PASS or FAIL");
  if (typeof value.benchmarkScore !== "number" || value.benchmarkScore < 0 || value.benchmarkScore > 100) errors.push("benchmarkScore must be between 0 and 100");
  if (!Array.isArray(value.categories) || value.categories.length === 0) errors.push("categories must be a non-empty array");
  else {
    const ids: string[] = [];
    value.categories.forEach((category, index) => {
      if (!isRecord(category) || typeof category.id !== "string" || !PASS_FAIL.has(category.state) || !EVIDENCE_STATES.has(category.compilerOverall) || typeof category.inputSha256 !== "string" || !SHA256.test(category.inputSha256) || !isStringArray(category.missingStages) || !Array.isArray(category.nonPassStages) || typeof category.stageScore !== "number") errors.push(`categories[${index}] is malformed`);
      else {
        ids.push(category.id);
        const expected = category.compilerOverall === "PASS" && category.missingStages.length === 0 && category.nonPassStages.length === 0 ? "PASS" : "FAIL";
        if (category.state !== expected) errors.push(`categories[${index}].state is inconsistent; expected ${expected}`);
      }
    });
    const coverage = sameMembers(ids, expectedCategories) ? "PASS" : "FAIL";
    if (value.categoryCoverage !== coverage) errors.push(`categoryCoverage is inconsistent; expected ${coverage}`);
    const score = Math.round(value.categories.reduce((sum, category) => sum + (isRecord(category) && typeof category.stageScore === "number" ? category.stageScore : 0), 0) / value.categories.length);
    if (value.benchmarkScore !== score) errors.push(`benchmarkScore is inconsistent; expected ${score}`);
  }
  const globalEvidence = requireRecord(value.globalEvidence, "globalEvidence", errors);
  if (globalEvidence && (Object.keys(globalEvidence).length === 0 || !Object.values(globalEvidence).every((state) => EVIDENCE_STATES.has(state)))) errors.push("globalEvidence must contain valid evidence states");
  if (!Array.isArray(value.missingGlobalEvidence) || !Array.isArray(value.nonPassGlobalEvidence)) errors.push("global evidence failure lists must be arrays");
  if (globalEvidence && Array.isArray(value.nonPassGlobalEvidence)) {
    const declared = value.nonPassGlobalEvidence.filter(isRecord).map((entry) => `${entry.name}:${entry.state}`).sort();
    const observed = Object.entries(globalEvidence).filter(([, state]) => state !== "PASS").map(([name, state]) => `${name}:${state}`).sort();
    if (!sameMembers(declared, observed)) errors.push("nonPassGlobalEvidence is inconsistent with globalEvidence");
  }
  if (Array.isArray(value.categories) && Array.isArray(value.nonPassGlobalEvidence)) {
    const expected = value.categoryCoverage === "PASS" && value.categories.every((category) => isRecord(category) && category.state === "PASS") && globalEvidence !== null && Object.values(globalEvidence).every((state) => state === "PASS") && value.nonPassGlobalEvidence.length === 0 ? "PASS" : "FAIL";
    if (value.overall !== expected) errors.push(`overall is inconsistent with Arena gates; expected ${expected}`);
  }
  return errors;
}

function validateShowcaseReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  requireString(value.fixture, "fixture", errors);
  requireString(value.runtimeReceipt, "runtimeReceipt", errors);
  requireStringArray(value.requiredArtifacts, "requiredArtifacts", errors, true);
  requireStringArray(value.missingArtifacts, "missingArtifacts", errors);
  const stageStates = requireRecord(value.stageStates, "stageStates", errors);
  if (stageStates && (Object.keys(stageStates).length === 0 || !Object.values(stageStates).every((state) => EVIDENCE_STATES.has(state)))) errors.push("stageStates must contain valid evidence states");
  const projection = requireRecord(value.projection, "projection", errors);
  if (projection && (typeof projection.checkedIn !== "string" || typeof projection.generated !== "string" || typeof projection.matchesCompiler !== "boolean")) errors.push("projection is malformed");
  requireString(value.route, "route", errors);
  requireString(value.fallbackQuery, "fallbackQuery", errors);
  if (stageStates && projection && Array.isArray(value.missingArtifacts)) {
    const expected = Object.values(stageStates).every((state) => state === "PASS") && value.missingArtifacts.length === 0 && projection.matchesCompiler === true ? "PASS" : "FAIL";
    if (value.overall !== expected) errors.push(`overall is inconsistent with showcase gates; expected ${expected}`);
  }
  return errors;
}

function validateExternalReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  for (const key of ["registry", "upstreamEvidence", "upstreamVerifiedAt", "verificationMode", "mode", "primaryArtDirector"] as const) requireString(value[key], key, errors);
  if (!Number.isInteger(value.enabledCount) || Number(value.enabledCount) < 0) errors.push("enabledCount must be a non-negative integer");
  const slots = requireRecord(value.capabilitySlots, "capabilitySlots", errors);
  if (slots && (Object.keys(slots).length === 0 || !Object.values(slots).every((state) => ["PASS", "FAIL", "NOT_ADMITTED"].includes(String(state))))) errors.push("capabilitySlots is malformed");
  requireStringArray(value.admittedCapabilities, "admittedCapabilities", errors);
  requireStringArray(value.evalsRequiredOnIdentityChange, "evalsRequiredOnIdentityChange", errors);
  for (const key of ["registryResolutions", "evidenceChecks"] as const) if (!Array.isArray(value[key]) || !value[key].every((entry) => isRecord(entry) && typeof entry.id === "string" && PASS_FAIL.has(entry.state))) errors.push(`${key} is malformed`);
  if (value.vendoredBodies !== "ABSENT") errors.push("vendoredBodies must be ABSENT");
  if (Array.isArray(value.registryResolutions) && Array.isArray(value.evidenceChecks)) {
    const expected = [...value.registryResolutions, ...value.evidenceChecks].every((entry) => isRecord(entry) && entry.state === "PASS") ? "PASS" : "FAIL";
    if (value.overall !== expected) errors.push(`overall is inconsistent with external skill checks; expected ${expected}`);
  }
  return errors;
}

function validateMediaReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  if (value.gate !== "DETERMINISTIC_MOCK") errors.push("gate must be DETERMINISTIC_MOCK");
  if (value.productionReleaseEligible !== false) errors.push("productionReleaseEligible must be false");
  requireString(value.requestId, "requestId", errors);
  for (const key of ["requestSha256", "promptSha256"] as const) if (typeof value[key] !== "string" || !SHA256.test(value[key])) errors.push(`${key} must be a SHA-256 digest`);
  const model = requireRecord(value.model, "model", errors);
  if (model) for (const key of ["id", "kind", "adapter", "admission", "versionOrCommit", "provenanceSubjectId", "outputTermsSubjectId"] as const) requireString(model[key], `model.${key}`, errors);
  if (!isRecord(value.parameters)) errors.push("parameters must be an object");
  const optimization = requireRecord(value.optimization, "optimization", errors);
  if (optimization && (optimization.target !== "web" || typeof optimization.maxBytes !== "number" || optimization.maxBytes <= 0)) errors.push("optimization is malformed");
  const queue = requireRecord(value.queue, "queue", errors);
  if (queue && (!Number.isInteger(queue.maxAttempts) || !Number.isInteger(queue.attempts) || Number(queue.maxAttempts) < 1 || Number(queue.attempts) < 0 || Number(queue.attempts) > Number(queue.maxAttempts) || queue.cancellation !== "SUPPORTED")) errors.push("queue is malformed");
  const asset = requireRecord(value.asset, "asset", errors);
  if (asset && (typeof asset.sha256 !== "string" || !SHA256.test(asset.sha256) || typeof asset.bytes !== "number" || asset.bytes <= 0 || typeof asset.mediaType !== "string" || typeof asset.extension !== "string")) errors.push("asset is malformed");
  requireStringArray(value.productCoreForbiddenImports, "productCoreForbiddenImports", errors, true);
  const isolation = requireRecord(value.workerIsolation, "workerIsolation", errors);
  if (isolation && isolation.wanGpProductCoreImport !== "ABSENT") errors.push("workerIsolation.wanGpProductCoreImport must be ABSENT");
  if (value.overall === "PASS" && (model?.admission !== "ALLOW" || model.adapter !== "mock" || !asset)) errors.push("PASS media evidence must identify an admitted mock result and retained asset");
  return errors;
}

function validateAuthoringReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  for (const key of ["library", "source", "ownership", "composition", "routes"] as const) if (!isRecord(value[key])) errors.push(`${key} must be an object`);
  const ownership = isRecord(value.ownership) ? value.ownership : null;
  if (ownership && ["arbitraryHtml", "arbitraryCssProps", "rawDesignValues"].some((key) => ownership[key] !== "FORBIDDEN")) errors.push("ownership must forbid arbitrary HTML, CSS props, and raw design values");
  const composition = isRecord(value.composition) ? value.composition : null;
  if (composition && (composition.deprecatedDropZoneUsed !== false || composition.slotFieldUsed !== true || composition.recursiveSection !== "FORBIDDEN" || !isStringArray(composition.sectionAllow, true))) errors.push("composition is malformed");
  const validation = requireRecord(value.validation, "validation", errors);
  if (validation && (!PASS_FAIL.has(validation.overall) || !Array.isArray(validation.errors))) errors.push("validation is malformed");
  if (typeof value.projectionMatchesCompilerFrontendPlan !== "boolean" || typeof value.compilerImportRoundTrip !== "boolean") errors.push("authoring projection checks must be booleans");
  requireString(value.publishedPersistence, "publishedPersistence", errors);
  requireString(value.cmsPersistence, "cmsPersistence", errors);
  if (validation) {
    const expected = validation.overall === "PASS" && value.projectionMatchesCompilerFrontendPlan === true && value.compilerImportRoundTrip === true ? "PASS" : "FAIL";
    if (value.overall !== expected) errors.push(`overall is inconsistent with authoring gates; expected ${expected}`);
  }
  return errors;
}

const CMS_TRUE_CHECKS = ["draftPublishedDistinguishable", "publishedProjectionMatchesSource", "draftProjectionValid", "versionCountAtLeastTwo", "guestCanReadPublished", "guestCannotReadMediaMetadata", "guestCannotReadLatestDraft", "mediaProvenanceLinked", "localizationReady", "compiledPageGraphCountSix", "compiledPageGraphFingerprintsMatch", "compiledPageGraphsRenderThroughPuckRegistry", "compiledDraftPublishedDistinguishable", "guestCannotReadCompiledDraft"];

function validateCmsReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  const payload = requireRecord(value.payload, "payload", errors);
  if (payload && (payload.adapter !== "@payloadcms/db-sqlite" || payload.database !== "EPHEMERAL_ARTIFACT" || payload.secretSource !== "RUNTIME_RANDOM_ONLY" || payload.productionCredentialSource !== "ENVIRONMENT_ONLY")) errors.push("payload governance is malformed");
  if (!isRecord(value.ownership) || !isRecord(value.evidence)) errors.push("ownership and evidence must be objects");
  const checks = requireRecord(value.checks, "checks", errors);
  if (checks) {
    if (checks.sourceValidation !== "PASS" || checks.publishedStatus !== "published" || checks.draftStatus !== "draft") errors.push("CMS status checks are inconsistent");
    for (const key of CMS_TRUE_CHECKS) if (checks[key] !== true) errors.push(`checks.${key} must be true`);
    for (const key of ["secretPersistedInReceipt", "productionCredentialInSource"]) if (checks[key] !== false) errors.push(`checks.${key} must be false`);
  }
  if (!Array.isArray(value.compiledPageGraphs) || value.compiledPageGraphs.length !== 6 || !value.compiledPageGraphs.every((entry) => isRecord(entry) && typeof entry.fingerprint === "string" && SHA256.test(entry.fingerprint) && entry.fingerprint === entry.declaredFingerprint && entry.fingerprint === entry.restoredFingerprint && entry.puckState === "PASS")) errors.push("compiledPageGraphs must contain six consistent round trips");
  if (value.overall === "PASS" && errors.length > 0) errors.push("overall PASS is inconsistent with CMS checks");
  return errors;
}

function validateRightsReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) errors.push("generatedAt must be an ISO timestamp");
  if (!Array.isArray(value.subjects) || value.subjects.length === 0) errors.push("subjects must be a non-empty array");
  const actualCounts = Object.fromEntries(RIGHTS_STATES.map((state) => [state, 0])) as Record<string, number>;
  const unresolved: string[] = [];
  const notices: string[] = [];
  if (Array.isArray(value.subjects)) value.subjects.forEach((subject, index) => {
    if (!isRecord(subject) || typeof subject.id !== "string" || typeof subject.kind !== "string" || typeof subject.name !== "string" || typeof subject.versionOrIdentity !== "string" || !RIGHTS_STATES.includes(subject.state as typeof RIGHTS_STATES[number]) || !isStringArray(subject.evidence, true) || typeof subject.attributionRequired !== "boolean" || typeof subject.distributed !== "boolean") {
      errors.push(`subjects[${index}] is malformed`);
      return;
    }
    const state = String(subject.state);
    actualCounts[state] = (actualCounts[state] ?? 0) + 1;
    if (subject.distributed && subject.state !== "ALLOW") unresolved.push(subject.id);
    if (subject.distributed && subject.attributionRequired) notices.push(subject.id);
  });
  const counts = requireRecord(value.counts, "counts", errors);
  if (counts) for (const state of RIGHTS_STATES) if (counts[state] !== actualCounts[state]) errors.push(`counts.${state} is inconsistent; expected ${actualCounts[state]}`);
  for (const key of ["unresolved", "expiredWaivers", "noticeSubjects"] as const) requireStringArray(value[key], key, errors);
  if (Array.isArray(value.unresolved) && !sameMembers(value.unresolved, unresolved)) errors.push("unresolved is inconsistent with distributed subjects");
  if (Array.isArray(value.noticeSubjects) && !sameMembers(value.noticeSubjects, notices)) errors.push("noticeSubjects is inconsistent with attributable subjects");
  if (value.legalDisclaimer !== "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE") errors.push("legalDisclaimer is invalid");
  if (Array.isArray(value.expiredWaivers)) {
    const expected = unresolved.length === 0 && value.expiredWaivers.length === 0 ? "PASS" : "FAIL";
    if (value.overall !== expected) errors.push(`overall is inconsistent with rights gates; expected ${expected}`);
  }
  return errors;
}

function validateCoreReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  const gates = validateStateRecord(value.gates, Object.values(RELEASE_CHILD_SPECS).map((spec) => spec.gate), "gates", errors);
  const evidence = requireRecord(value.evidence, "evidence", errors);
  const bindings = requireRecord(value.evidenceBindings, "evidenceBindings", errors);
  const git = requireRecord(value.git, "git", errors);
  if (!isRecord(value.workflow) || !isStringArray(value.workflow.commands, true)) errors.push("workflow must retain executed commands");
  if (!isRecord(value.environment)) errors.push("environment must be an object");
  if (!isRecord(value.optionalEvidence)) errors.push("optionalEvidence must be an object");
  if (!Array.isArray(value.unresolvedRisks)) errors.push("unresolvedRisks must be an array");
  const gateNames = Object.values(RELEASE_CHILD_SPECS).map((spec) => spec.gate);
  if (gates && !sameMembers(Object.keys(gates), gateNames)) errors.push("gates must contain exactly the twelve governed children");
  if (evidence && !sameMembers(Object.keys(evidence), gateNames)) errors.push("evidence must contain exactly the twelve governed child paths");
  if (bindings && !sameMembers(Object.keys(bindings), Object.keys(RELEASE_CHILD_SPECS))) errors.push("evidenceBindings must contain exactly the twelve governed children");
  for (const [name, spec] of Object.entries(RELEASE_CHILD_SPECS)) {
    if (evidence?.[spec.gate] !== spec.path) errors.push(`evidence.${spec.gate} must be ${spec.path}`);
    const binding = bindings && isRecord(bindings[name]) ? bindings[name] as JsonRecord : null;
    if (!binding) {
      errors.push(`evidenceBindings.${name} must be an object`);
      continue;
    }
    if (binding.path !== spec.path) errors.push(`evidenceBindings.${name}.path must be ${spec.path}`);
    if (binding.schema !== spec.schema) errors.push(`evidenceBindings.${name}.schema must be ${spec.schema}`);
    if (!EVIDENCE_STATES.has(binding.state)) errors.push(`evidenceBindings.${name}.state is invalid`);
    if (!["BOUND", "MISMATCH", "ABSENT"].includes(String(binding.binding))) errors.push(`evidenceBindings.${name}.binding is invalid`);
    if (!Array.isArray(binding.errors) || !binding.errors.every((entry) => typeof entry === "string")) errors.push(`evidenceBindings.${name}.errors must be text`);
    if (typeof binding.sha256 !== "string" || !SHA256.test(binding.sha256)) errors.push(`evidenceBindings.${name}.sha256 must be a SHA-256 digest`);
    if (!isRecord(binding.git) || binding.git.sha !== git?.sha || binding.git.ref !== git?.ref) errors.push(`evidenceBindings.${name}.git must match the umbrella subject`);
    if (gates && gates[spec.gate] !== binding.state) errors.push(`gates.${spec.gate} must match evidenceBindings.${name}.state`);
    if (value.overall === "PASS" && (binding.binding !== "BOUND" || binding.state !== "PASS" || (Array.isArray(binding.errors) && binding.errors.length > 0))) errors.push(`evidenceBindings.${name} is not a clean PASS binding`);
  }
  if (gates && value.overall !== (Object.values(gates).every((state) => state === "PASS") ? "PASS" : "FAIL")) errors.push("overall is inconsistent with release gates");
  return errors;
}

const STRUCTURAL_VALIDATORS: Record<string, (value: JsonRecord) => string[]> = {
  "website-design-compiler/runtime-receipt/v1": validateRuntimeReceipt,
  "website-design-compiler/browser-qa-runtime-receipt/v1": validateBrowserReceipt,
  "website-design-compiler/accessibility-performance-receipt/v1": validateQualityReceipt,
  "website-design-compiler/storybook-workshop-receipt/v1": validateStorybookReceipt,
  "website-design-compiler/shared-binding-receipt/v1": validateSharedBindingReceipt,
  "website-design-compiler/arena-score/v1": validateArenaReceipt,
  "website-design-compiler/showcase-compiler-receipt/v1": validateShowcaseReceipt,
  "website-design-compiler/external-skill-registry-admission-receipt/v1": validateExternalReceipt,
  "website-design-compiler/media-generation-receipt/v1": validateMediaReceipt,
  "website-design-compiler/authoring-receipt/v1": validateAuthoringReceipt,
  "website-design-compiler/payload-cms-receipt/v2": validateCmsReceipt,
  "website-design-compiler/repository-rights-clearance/v2": validateRightsReceipt,
  "website-design-compiler/release-gate-receipt/v2": validateCoreReceipt
};

export function bindReleaseEvidence(
  receipt: unknown,
  expectedSchema: string,
  expectedGit: { sha: string; ref: string }
): ReleaseEvidenceBinding {
  if (!isRecord(receipt)) {
    return { state: "ABSENT", binding: "ABSENT", schema: null, git: null, errors: ["receipt is absent"] };
  }
  const errors: string[] = [];
  if (receipt.schema !== expectedSchema) errors.push(`schema must be ${expectedSchema}`);
  const state = receipt.overall;
  if (!EVIDENCE_STATES.has(state)) errors.push("overall evidence state is invalid");
  const gitValue = isRecord(receipt.git) ? receipt.git : null;
  const git = typeof gitValue?.sha === "string" && typeof gitValue.ref === "string"
    ? { sha: gitValue.sha, ref: gitValue.ref }
    : null;
  const binding = git === null ? "ABSENT" : git.sha === expectedGit.sha && git.ref === expectedGit.ref ? "BOUND" : "MISMATCH";
  if (binding !== "BOUND") errors.push(`git binding is ${binding}`);
  if (!GIT_SHA.test(expectedGit.sha) || !expectedGit.ref.startsWith("refs/")) errors.push("expected Git subject must contain an exact SHA and ref");
  if (git && (!GIT_SHA.test(git.sha) || !git.ref.startsWith("refs/"))) errors.push("receipt Git subject must contain an exact SHA and ref");
  const validator = STRUCTURAL_VALIDATORS[expectedSchema];
  if (!validator) errors.push(`no structural validator for schema ${expectedSchema}`);
  else errors.push(...validator(receipt));
  return {
    state: errors.length === 0 ? state as ReleaseInputState : "FAIL",
    binding,
    schema: typeof receipt.schema === "string" ? receipt.schema : null,
    git,
    errors
  };
}

function fileFailure(path: string, message: string, sha256: string | null = null): ReleaseEvidenceFileBinding {
  return { state: "FAIL", binding: "ABSENT", schema: null, git: null, errors: [message], path, sha256 };
}

export async function readBoundReleaseEvidence(
  root: string,
  path: string,
  expectedSchema: string,
  expectedGit: { sha: string; ref: string }
): Promise<ReleaseEvidenceFileBinding> {
  try {
    const bytes = await readFile(join(root, path));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    try {
      return { ...bindReleaseEvidence(JSON.parse(bytes.toString("utf8")), expectedSchema, expectedGit), path, sha256 };
    } catch {
      return fileFailure(path, "receipt JSON is malformed", sha256);
    }
  } catch {
    return fileFailure(path, "receipt is missing or unreadable");
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function verifyCoreReleaseEvidence(root: string, expectedGit: { sha: string; ref: string }): Promise<ReleaseEvidenceBinding> {
  const corePath = "artifacts/release/release-gate-receipt.json";
  let value: JsonRecord;
  try {
    const parsed = JSON.parse(await readFile(join(root, corePath), "utf8")) as unknown;
    if (!isRecord(parsed)) return fileFailure(corePath, "core release receipt must be an object");
    value = parsed;
  } catch {
    return fileFailure(corePath, "core release receipt is missing or malformed");
  }
  const core = bindReleaseEvidence(value, "website-design-compiler/release-gate-receipt/v2", expectedGit);
  const errors = [...core.errors];
  const declaredBindings = isRecord(value.evidenceBindings) ? value.evidenceBindings : {};
  for (const [name, spec] of Object.entries(RELEASE_CHILD_SPECS)) {
    const observed = await readBoundReleaseEvidence(root, spec.path, spec.schema, expectedGit);
    const declared = isRecord(declaredBindings[name]) ? declaredBindings[name] as JsonRecord : null;
    if (observed.state !== "PASS" || observed.binding !== "BOUND" || observed.errors.length > 0) errors.push(`${name}: child revalidation failed: ${observed.errors.join("; ") || observed.state}`);
    if (!declared) {
      errors.push(`${name}: umbrella binding is absent`);
      continue;
    }
    for (const key of ["state", "binding", "schema", "git", "path", "sha256", "errors"] as const) {
      if (!jsonEqual(declared[key], observed[key])) errors.push(`${name}: umbrella ${key} does not match re-read child`);
    }
  }
  return { ...core, state: core.state === "PASS" && errors.length === 0 ? "PASS" : "FAIL", errors };
}
