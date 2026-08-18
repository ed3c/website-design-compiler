import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { routeArtDirection } from "./art-direction.js";
import { compileCompletePageGraph, type CompletePageGraph } from "./complete-page-graph.js";
import type { CompilerInput } from "./contracts.js";
import { evaluateDesignQuality, evaluateDesignQualityV3, type OriginalitySubject, type QualityViewport } from "./design-quality-eval.js";
import type { DesignQualityBrowserObservation, RuntimeTokenMatch, VisualOriginalitySubject } from "./design-quality-observation.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding, type ExpectedDesignQualityEvidence } from "./design-quality-evidence.js";
import { buildFrontendPlan } from "./frontend-builder.js";
import { buildGraphics2DPlan } from "./graphics-2d.js";
import { buildGraphics3DPlan } from "./graphics-3d.js";
import { buildMotionDirectorPlan } from "./motion-director.js";
import { GENERATED_PAGE_CANONICAL_VIEWPORTS, validateTrustedGeneratedPageBrowserAdmission } from "./generated-page-browser-admission.js";
import { assertPngEvidence } from "./png-evidence.js";
import { buildReferenceManifest } from "./reference-intelligence.js";
import { compileAllSectionPageFixtures } from "./section-page-fixtures.js";
import {
  CAPABILITY_RECEIPT_CONTRACTS,
  type Capability,
  type CapabilityEvidence,
  type CapabilityState
} from "./release-policy-v2.js";
import { validateAgainstSchema, validateCompilerInput } from "./validate.js";

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
const REQUIRED_RUNTIME_STAGES = ["reference-intelligence", "art-direction", "frontend-builder", "motion-director", "graphics-2d", "graphics-3d", "release-receipt"];
const JSON_SCHEMA_FILES: Record<string, string> = {
  "website-design-compiler/reference-manifest/v1": "reference-manifest.schema.json",
  "website-design-compiler/design-read/v1": "design-read.schema.json",
  "website-design-compiler/frontend-plan/v1": "frontend-plan.schema.json",
  "website-design-compiler/motion-director/v1": "motion-director.schema.json",
  "website-design-compiler/graphics-2d-plan/v1": "graphics-2d-plan.schema.json",
  "website-design-compiler/graphics-3d-plan/v2": "graphics-3d-plan.schema.json",
  "website-design-compiler/semantic-design-tokens/v2": "semantic-design-tokens-v2.schema.json",
  "website-design-compiler/generated-page-visual-observation/v1": "generated-page-visual-observation.schema.json",
  "website-design-compiler/live-reference-receipt/v2": "live-reference-receipt.schema.json",
  "website-design-compiler/webgpu-runtime-receipt/v1": "webgpu-runtime-receipt.schema.json",
  "website-design-compiler/production-provider-status/v2": "production-provider-status.schema.json",
  "website-design-compiler/design-quality-eval-receipt/v3": "design-quality-eval-receipt-v3.schema.json"
};
const jsonSchemaValidators = new Map<string, ValidateFunction>();
const READBACK_REQUIRED_SCHEMAS = new Set([
  "website-design-compiler/runtime-receipt/v1",
  "website-design-compiler/design-quality-eval-receipt/v3",
  "website-design-compiler/production-provider-status/v2"
]);
const RUNTIME_ARTIFACT_SPECS: Record<string, { path: string; schema: string | null }> = {
  "reference-intelligence": { path: "reference-intelligence/reference-manifest.json", schema: "website-design-compiler/reference-manifest/v1" },
  "art-direction": { path: "art-direction/design-read.json", schema: "website-design-compiler/design-read/v1" },
  "frontend-builder": { path: "frontend-builder/frontend-plan.json", schema: "website-design-compiler/frontend-plan/v1" },
  "motion-director": { path: "motion-director/motion-plan.json", schema: "website-design-compiler/motion-director/v1" },
  "graphics-2d": { path: "graphics-2d/graphics-2d-plan.json", schema: "website-design-compiler/graphics-2d-plan/v1" },
  "graphics-3d": { path: "graphics-3d/graphics-3d-plan.json", schema: "website-design-compiler/graphics-3d-plan/v2" },
  "release-receipt": { path: "runtime-receipt.json", schema: null }
};

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

export const RELEASE_CAPABILITY_SPECS = {
  liveReference: { path: "artifacts/live-reference/live-reference-receipt.json", schema: "website-design-compiler/live-reference-receipt/v2" },
  webgpu: { path: "artifacts/graphics-3d/webgpu-receipt.json", schema: "website-design-compiler/webgpu-runtime-receipt/v1" },
  repositoryRights: { path: RELEASE_CHILD_SPECS.rights.path, schema: RELEASE_CHILD_SPECS.rights.schema },
  productionProvider: { path: "artifacts/media-generator/production-provider-status.json", schema: "website-design-compiler/production-provider-status/v2" },
  premiumQuality: { path: "artifacts/v3/design-quality/design-quality-eval-receipt.json", schema: "website-design-compiler/design-quality-eval-receipt/v3" }
} as const;

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

function validatePublishedSchema(value: unknown, schema: string): string[] {
  const schemaFile = JSON_SCHEMA_FILES[schema];
  if (!schemaFile) return [];
  let validator = jsonSchemaValidators.get(schema);
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    validator = ajv.compile(JSON.parse(readFileSync(resolve(process.cwd(), "schemas", schemaFile), "utf8")) as object);
    jsonSchemaValidators.set(schema, validator);
  }
  return validator(value) ? [] : (validator.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
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
    if (!Array.isArray(stage.artifacts) || !stage.artifacts.every((entry) => typeof entry === "string" && entry.length > 0)) errors.push(`stages[${index}].artifacts must be non-empty text paths`);
    else if (stage.state === "PASS" && stage.artifacts.length === 0) errors.push(`stages[${index}].artifacts cannot be empty for PASS`);
  });
  if (!sameMembers([...names], REQUIRED_RUNTIME_STAGES)) errors.push("stages must cover the exact governed minimal runtime pipeline");
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
    if (artifacts.runtimeReport !== null && typeof artifacts.runtimeReport !== "string") errors.push("artifacts.runtimeReport must be a path or null");
    requireStringArray(artifacts.screenshots, "artifacts.screenshots", errors);
    requireStringArray(artifacts.traces, "artifacts.traces", errors);
  }
  const gates = validatePassFailRecord(value.gates, ["browserMatrix", "screenshots", "traces", "playwrightReport", "playwrightRuntimeReport"], "gates", errors);
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
      playwrightReport: typeof artifacts.report === "string" && artifacts.report.length > 0 ? "PASS" : "FAIL",
      playwrightRuntimeReport: typeof artifacts.runtimeReport === "string" && artifacts.runtimeReport.length > 0 ? "PASS" : "FAIL"
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
      const inputSha256Valid = isRecord(category) && typeof category.inputSha256 === "string" &&
        (SHA256.test(category.inputSha256) || (category.compilerOverall === "ABSENT" && category.inputSha256 === "ABSENT"));
      if (!isRecord(category) || typeof category.id !== "string" || !PASS_FAIL.has(category.state) || !EVIDENCE_STATES.has(category.compilerOverall) || !inputSha256Valid || !isStringArray(category.missingStages) || !Array.isArray(category.nonPassStages) || typeof category.stageScore !== "number") errors.push(`categories[${index}] is malformed`);
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

function validateLiveReferenceReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  if (!["PASS", "FAIL", "NOT_EXERCISED"].includes(String(value.overall))) errors.push("overall must be PASS, FAIL, or NOT_EXERCISED");
  if (value.executionMode !== "LIVE") errors.push("executionMode must be LIVE");
  if (!["PRODUCTION", "INJECTED"].includes(String(value.transportMode))) errors.push("transportMode is invalid");
  const approval = requireRecord(value.approval, "approval", errors);
  if (approval && (!Number.isInteger(approval.targetCount) || Number(approval.targetCount) < 2 || typeof approval.id !== "string" || !Number.isFinite(Date.parse(String(approval.approvedAt))))) errors.push("approval is malformed");
  const policy = requireRecord(value.policy, "policy", errors);
  if (policy && (policy.minimumDistinctHttpsTargets !== 2 || !["timeoutMs", "maxAttempts", "retryBackoffMs", "maxRedirects", "maxBytes"].every((key) => Number.isInteger(policy[key]) && Number(policy[key]) >= 0))) errors.push("policy is malformed");
  if (!Array.isArray(value.targets)) errors.push("targets must be an array");
  if (value.overall === "PASS") {
    if (value.transportMode !== "PRODUCTION" || value.promotionBlockedReason !== null) errors.push("PASS requires production transport with no blocked reason");
    if (!Array.isArray(value.targets) || value.targets.length < 2) errors.push("PASS requires at least two live targets");
    else value.targets.forEach((target, index) => {
      if (!isRecord(target) || target.state !== "PASS" || target.availability !== "AVAILABLE" || typeof target.targetUrl !== "string" || !target.targetUrl.startsWith("https://") || typeof target.finalUrl !== "string" || !target.finalUrl.startsWith("https://") || typeof target.responseSha256 !== "string" || !SHA256.test(target.responseSha256) || target.artifactIdentity !== `sha256:${target.responseSha256}` || typeof target.connectedAddress !== "string" || target.connectedAddress.length === 0 || !Number.isInteger(target.httpStatus) || Number(target.httpStatus) < 100 || Number(target.httpStatus) > 599 || typeof target.contentType !== "string" || !["text/html", "application/xhtml+xml"].includes(target.contentType) || !Number.isInteger(target.responseBytes) || Number(target.responseBytes) < 1 || !Number.isFinite(Date.parse(String(target.capturedAt))) || !Array.isArray(target.dnsResolutions) || target.dnsResolutions.length === 0 || !Array.isArray(target.redirectChain) || !Number.isInteger(target.attemptCount) || Number(target.attemptCount) < 1 || !Array.isArray(target.observations) || target.implementationDetails !== "UNKNOWN" || !["BASELINE", "UNCHANGED", "CHANGED"].includes(String(target.drift))) errors.push(`targets[${index}] is not PASS-bound live evidence`);
    });
  }
  if (value.transportMode === "INJECTED" && value.overall === "PASS") errors.push("injected transport cannot promote live reference PASS");
  return errors;
}

function validateWebgpuReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  if (!["PASS", "FAIL", "NOT_EXERCISED"].includes(String(value.overall))) errors.push("overall must be PASS, FAIL, or NOT_EXERCISED");
  const selected = requireRecord(value.selected, "selected", errors);
  const fallbacks = requireRecord(value.fallbacks, "fallbacks", errors);
  if (fallbacks && (fallbacks.totalGpuFailure !== "PASS" || !["PASS", "NOT_EXERCISED"].includes(String(fallbacks.initializationFailure)) || !["PASS", "NOT_EXERCISED"].includes(String(fallbacks.deviceLoss)))) errors.push("fallback evidence is malformed");
  if (value.overall === "PASS") {
    const runtime = selected && isRecord(selected.runtime) ? selected.runtime : null;
    const identity = runtime && isRecord(runtime.identity) ? runtime.identity : null;
    const budget = runtime && isRecord(runtime.budget) ? runtime.budget : null;
    const capabilities = selected && isRecord(selected.capabilities) ? selected.capabilities : null;
    if (!selected || value.rendererOutcome !== "WEBGPU_PASS" || selected.state !== "WEBGPU_PASS" || selected.renderer !== "webgpu" || capabilities?.webgpu !== true || typeof capabilities.webgl !== "boolean" || !runtime || runtime.state !== "WEBGPU_PASS" || identity?.adapter !== "navigator.gpu" || identity?.renderer !== "three.WebGPURenderer" || typeof identity.rendererVersion !== "string" || typeof identity.tslModule !== "string" || !isRecord(identity.adapterInfo) || !Array.isArray(identity.features) || !isRecord(identity.limits) || !budget || budget.frameLoop !== "demand" || !["dpr", "drawCalls", "triangles", "textureBytes", "framesRendered"].every((key) => typeof budget[key] === "number")) errors.push("PASS requires an exercised WebGPU runtime with identity and budget evidence");
  }
  return errors;
}

function validateProductionProviderStatus(value: JsonRecord): string[] {
  const errors: string[] = [];
  if(value.gate!=="PRODUCTION_PROVIDER")errors.push("gate must be PRODUCTION_PROVIDER");
  if(!["PASS","FAIL","NOT_EXERCISED"].includes(String(value.overall)))errors.push("overall must be PASS, FAIL, or NOT_EXERCISED");
  if(value.deterministicMockGate!=="SEPARATE")errors.push("deterministic mock gate must remain separate");
  if(value.overall==="PASS"){
    if(value.admissionState!=="ADMITTED"||value.productionReleaseEligible!==true||value.rightsClearance!=="PASS"||value.runtimeCredentials!=="AVAILABLE"||value.budgetAuthorization!=="AUTHORIZED")errors.push("PASS provider status lacks admitted runtime, rights, credentials, or budget evidence");
    for(const key of ["executionReceiptSha256","requestSha256","assetSha256"] as const)if(typeof value[key]!=="string"||!SHA256.test(value[key]))errors.push(`${key} is not a SHA-256 digest`);
    if(!isRecord(value.artifacts))errors.push("PASS provider status lacks persisted artifact bindings");
  }else if(value.productionReleaseEligible!==false)errors.push("non-PASS provider status cannot be release eligible");
  requireString(value.reason, "reason", errors);
  return errors;
}

function validatePremiumQualityReceipt(value: JsonRecord): string[] {
  const errors: string[] = [];
  if (!PASS_FAIL.has(value.overall)) errors.push("overall must be PASS or FAIL");
  const viewportCoverage = requireRecord(value.viewportCoverage, "viewportCoverage", errors);
  const premium = requireRecord(value.premium, "premium", errors);
  if (!Number.isInteger(value.categoryCount) || Number(value.categoryCount) < 0) errors.push("categoryCount must be an integer");
  for (const key of ["exactHeadBound", "allEvidenceBound", "allStructuralPass", "allOriginalityPass", "allMeasurementsPass"] as const) if (typeof value[key] !== "boolean") errors.push(`${key} must be boolean`);
  if (premium && (!PASS_FAIL.has(premium.state) || !Array.isArray(premium.evaluations))) errors.push("premium evidence is malformed");
  const releaseProfile = requireRecord(value.releaseProfile, "releaseProfile", errors);
  if (releaseProfile && (typeof releaseProfile.sha256 !== "string" || !SHA256.test(releaseProfile.sha256) || !Array.isArray(releaseProfile.requiredViewports) || !sameMembers(releaseProfile.requiredViewports.map(String), ["mobile", "desktop"]) || typeof releaseProfile.premiumQualityThreshold !== "number" || typeof releaseProfile.originalitySimilarityThreshold !== "number" || releaseProfile.requireExactEvidenceBinding !== true)) errors.push("releaseProfile is malformed");
  const calibration=requireRecord(value.calibration,"calibration",errors);
  if(calibration&&(calibration.state!=="PASS"||calibration.exactObservationSetBound!==true||typeof calibration.sha256!=="string"||!SHA256.test(calibration.sha256)))errors.push("calibration is not exact-observation PASS evidence");
  const git = isRecord(value.git) ? value.git : null;
  const observedPairs: string[] = [];
  if (premium && Array.isArray(premium.evaluations)) premium.evaluations.forEach((evaluation, index) => {
    if (!isRecord(evaluation)) { errors.push(`premium.evaluations[${index}] must be an object`); return; }
    const card = requireRecord(evaluation.card, `premium.evaluations[${index}].card`, errors);
    const binding = requireRecord(evaluation.binding, `premium.evaluations[${index}].binding`, errors);
    const decision = requireRecord(evaluation.decision, `premium.evaluations[${index}].decision`, errors);
    const source = requireRecord(evaluation.source, `premium.evaluations[${index}].source`, errors);
    if (card) {
      if (card.schema!=="website-design-compiler/design-quality-eval/v3"||typeof card.category !== "string" || !["mobile", "desktop"].includes(String(card.viewport)) || typeof card.score !== "number" || !isRecord(card.originalityAudit) || card.originalityAudit.state !== "PASS"||!isRecord(card.measurement)||card.measurement.state!=="PASS") errors.push(`premium.evaluations[${index}].card is malformed`);
      else observedPairs.push(`${card.category}:${card.viewport}`);
    }
    if (binding && (binding.gitSha !== git?.sha || !["pageGraphSha256", "designTokensSha256", "screenshotSha256"].every((key) => typeof binding[key] === "string" && SHA256.test(String(binding[key]))) || typeof binding.screenshotPath !== "string" || binding.screenshotPath.length === 0 || typeof binding.graphSignature !== "string" || binding.graphSignature.length === 0)) errors.push(`premium.evaluations[${index}].binding is not exact-head evidence`);
    if (decision && (decision.overall !== "PREMIUM_PASS" || decision.evidenceState !== "PASS" || decision.structuralState !== "PASS")) errors.push(`premium.evaluations[${index}].decision did not pass`);
    if (source && !["generatedPageReceipt", "generatedPageReceiptGitSha", "qualityObservationPath", "qualityObservationSha256", "productionProjection", "productionProjectionPath", "productionProjectionSha256", "semanticTokensSourceSha256"].every((key) => typeof source[key] === "string" && String(source[key]).length > 0)) errors.push(`premium.evaluations[${index}].source is not artifact-addressable`);
  });
  if (observedPairs.length > 0 && new Set(observedPairs).size !== observedPairs.length) errors.push("premium evaluations contain duplicated category/viewports");
  if (value.overall === "PASS" && (value.categoryCount !== 6 || viewportCoverage?.mobile !== 6 || viewportCoverage?.desktop !== 6 || value.exactHeadBound !== true || value.allEvidenceBound !== true || value.allStructuralPass !== true || value.allOriginalityPass !== true || value.allMeasurementsPass!==true||calibration?.state!=="PASS"||calibration?.exactObservationSetBound!==true||premium?.state !== "PASS" || !Array.isArray(premium.evaluations) || premium.evaluations.length !== 12 || observedPairs.length !== 12)) errors.push("PASS is inconsistent with premium evidence coverage and bindings");
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
  "website-design-compiler/release-gate-receipt/v2": validateCoreReceipt,
  "website-design-compiler/live-reference-receipt/v2": validateLiveReferenceReceipt,
  "website-design-compiler/webgpu-runtime-receipt/v1": validateWebgpuReceipt,
  "website-design-compiler/production-provider-status/v2": validateProductionProviderStatus,
  "website-design-compiler/design-quality-eval-receipt/v3": validatePremiumQualityReceipt
};

function bindReleaseEvidenceStructure(
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
  else errors.push(...validatePublishedSchema(receipt, expectedSchema), ...validator(receipt));
  return {
    state: errors.length === 0 ? state as ReleaseInputState : "FAIL",
    binding,
    schema: typeof receipt.schema === "string" ? receipt.schema : null,
    git,
    errors
  };
}

export function bindReleaseEvidence(
  receipt: unknown,
  expectedSchema: string,
  expectedGit: { sha: string; ref: string }
): ReleaseEvidenceBinding {
  const result = bindReleaseEvidenceStructure(receipt, expectedSchema, expectedGit);
  if (result.state === "PASS" && READBACK_REQUIRED_SCHEMAS.has(expectedSchema)) {
    return { ...result, state: "FAIL", errors: [...result.errors, `${expectedSchema} PASS requires artifact readback`] };
  }
  return result;
}

function fileFailure(path: string, message: string, sha256: string | null = null): ReleaseEvidenceFileBinding {
  return { state: "FAIL", binding: "ABSENT", schema: null, git: null, errors: [message], path, sha256 };
}

async function validateRuntimeArtifacts(root: string, receiptPath: string, receipt: JsonRecord): Promise<string[]> {
  const errors: string[] = [];
  if (!Array.isArray(receipt.stages)) return errors;
  const receiptDirectory = dirname(resolve(root, receiptPath));
  let canonicalReceiptDirectory: string;
  try { canonicalReceiptDirectory = await realpath(receiptDirectory); }
  catch { return ["runtime receipt directory is missing or unreadable"]; }
  const expectedRuntimeArtifactBytes = new Map<string, Buffer>();
  try {
    const rawInput = JSON.parse(await readFile(resolve(root, "fixtures/minimal/compiler-input.json"), "utf8")) as unknown;
    const input: CompilerInput = await validateCompilerInput(rawInput);
    const inputSha256 = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    if (receipt.inputSha256 !== inputSha256) errors.push("runtime receipt inputSha256 does not match the governed minimal compiler input");
    if (receipt.project !== input.project) errors.push("runtime receipt project does not match the governed minimal compiler input");
    if (!sameMembers(receipt.stages.map((stage) => isRecord(stage) ? String(stage.stage) : ""), input.requestedStages)) errors.push("runtime stages do not match the governed minimal compiler input");
    const manifest = await buildReferenceManifest(input);
    const observedReferenceCount = manifest.entries.filter((entry) => entry.captureState === "PASS").length;
    if (!input.artDirection) throw new Error("governed minimal input lacks art direction");
    expectedRuntimeArtifactBytes.set("reference-intelligence/reference-manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    expectedRuntimeArtifactBytes.set("art-direction/design-read.json", Buffer.from(`${JSON.stringify(routeArtDirection(input, input.artDirection, observedReferenceCount), null, 2)}\n`));
    expectedRuntimeArtifactBytes.set("frontend-builder/frontend-plan.json", Buffer.from(`${JSON.stringify(buildFrontendPlan(input), null, 2)}\n`));
    expectedRuntimeArtifactBytes.set("motion-director/motion-plan.json", Buffer.from(`${JSON.stringify(buildMotionDirectorPlan(input), null, 2)}\n`));
    expectedRuntimeArtifactBytes.set("graphics-2d/graphics-2d-plan.json", Buffer.from(`${JSON.stringify(buildGraphics2DPlan(), null, 2)}\n`));
    expectedRuntimeArtifactBytes.set("graphics-3d/graphics-3d-plan.json", Buffer.from(`${JSON.stringify(buildGraphics3DPlan(), null, 2)}\n`));
  } catch {
    errors.push("governed minimal compiler input is missing or invalid");
  }
  const observedArtifacts = new Set<string>();
  for (const [stageIndex, stage] of receipt.stages.entries()) {
    if (!isRecord(stage) || stage.state !== "PASS" || !Array.isArray(stage.artifacts)) continue;
    const artifactSpec = RUNTIME_ARTIFACT_SPECS[String(stage.stage)];
    if (!artifactSpec || !stage.artifacts.includes(artifactSpec.path)) {
      errors.push(`stages[${stageIndex}] does not declare its canonical artifact`);
    }
    for (const [artifactIndex, artifact] of stage.artifacts.entries()) {
      if (typeof artifact !== "string" || artifact.length === 0 || isAbsolute(artifact)) {
        errors.push(`stages[${stageIndex}].artifacts[${artifactIndex}] is not a safe relative path`);
        continue;
      }
      const absolutePath = resolve(receiptDirectory, artifact);
      const traversal = relative(receiptDirectory, absolutePath);
      if (traversal.split(/[\\/]/)[0] === ".." || isAbsolute(traversal)) {
        errors.push(`stages[${stageIndex}].artifacts[${artifactIndex}] escapes the runtime receipt directory`);
        continue;
      }
      if (observedArtifacts.has(artifact)) errors.push(`stages[${stageIndex}].artifacts[${artifactIndex}] reuses an artifact declared by another stage`);
      observedArtifacts.add(artifact);
      try {
        const canonicalPath = await realpath(absolutePath);
        const expectedCanonicalPath = resolve(canonicalReceiptDirectory, artifact);
        const canonicalTraversal = relative(canonicalReceiptDirectory, canonicalPath);
        if (canonicalTraversal.split(/[\\/]/)[0] === ".." || isAbsolute(canonicalTraversal) || canonicalPath !== expectedCanonicalPath) {
          errors.push(`stages[${stageIndex}].artifacts[${artifactIndex}] resolves through a symbolic link or outside the runtime directory`);
          continue;
        }
        const bytes = await readFile(canonicalPath);
        if (bytes.length === 0) errors.push(`stages[${stageIndex}].artifacts[${artifactIndex}] is empty`);
        const expectedBytes = expectedRuntimeArtifactBytes.get(artifact);
        if (expectedBytes && !bytes.equals(expectedBytes)) errors.push(`stages[${stageIndex}] canonical artifact does not match current compiler output`);
        if (artifactSpec?.path === artifact && artifactSpec.schema !== null) {
          try {
            const value = JSON.parse(bytes.toString("utf8")) as unknown;
            errors.push(...validatePublishedSchema(value, artifactSpec.schema).map((error) => `stages[${stageIndex}] canonical artifact ${error}`));
          } catch {
            errors.push(`stages[${stageIndex}] canonical artifact is not valid JSON`);
          }
        }
      } catch {
        errors.push(`stages[${stageIndex}].artifacts[${artifactIndex}] is missing or unreadable`);
      }
    }
  }
  return errors;
}

async function validateProductionProviderArtifacts(root:string,receipt:JsonRecord):Promise<string[]>{
  if(receipt.overall!=="PASS")return[];
  const errors:string[]=[];
  const artifacts=isRecord(receipt.artifacts)?receipt.artifacts:null;
  const execution=artifacts&&isRecord(artifacts.executionReceipt)?artifacts.executionReceipt:null;
  const asset=artifacts&&isRecord(artifacts.asset)?artifacts.asset:null;
  const readBound=async(binding:JsonRecord|null,label:string):Promise<Buffer|null>=>{
    if(!binding||typeof binding.path!=="string"||!/^[A-Za-z0-9._-]+$/.test(binding.path)){errors.push(`${label} path is unsafe`);return null;}
    const path=binding.path;
    const base=resolve(root,"artifacts/media-generator");
    try{
      const canonicalBase=await realpath(base);const target=resolve(base,path);const canonicalTarget=await realpath(target);
      if(canonicalTarget!==resolve(canonicalBase,path)){errors.push(`${label} resolves through a symbolic link or outside its artifact directory`);return null;}
      const bytes=await readFile(canonicalTarget);const digest=createHash("sha256").update(bytes).digest("hex");
      if(binding.sha256!==digest)errors.push(`${label} SHA-256 mismatch`);
      if(binding.bytes!==bytes.byteLength)errors.push(`${label} byte count mismatch`);
      return bytes;
    }catch{errors.push(`${label} is missing or unreadable`);return null;}
  };
  const executionBytes=await readBound(execution,"production execution receipt");
  const assetBytes=await readBound(asset,"production provider asset");
  if(execution?.sha256!==receipt.executionReceiptSha256)errors.push("status executionReceiptSha256 does not match its artifact binding");
  if(asset?.sha256!==receipt.assetSha256)errors.push("status assetSha256 does not match its artifact binding");
  if(executionBytes){
    try{
      const value=JSON.parse(executionBytes.toString("utf8")) as unknown;
      if(!isRecord(value)||value.schema!=="website-design-compiler/production-provider-receipt/v2"||value.overall!=="PASS"||!isRecord(value.asset)||value.asset.sha256!==receipt.assetSha256||value.asset.bytes!==assetBytes?.byteLength)errors.push("production execution receipt does not bind the persisted PASS asset");
    }catch{errors.push("production execution receipt is not valid JSON");}
  }
  return errors;
}

async function validatePremiumArtifactsV2(root: string, receipt: JsonRecord): Promise<string[]> {
  if (receipt.overall !== "PASS") return [];
  const errors: string[] = [];
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(root); }
  catch { return ["release workspace is missing or unreadable"]; }
  const readArtifact = async (path: unknown, label: string): Promise<{ bytes: Buffer; value: unknown } | null> => {
    if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) {
      errors.push(`${label} is not a safe relative path`);
      return null;
    }
    const absolutePath = resolve(root, path);
    const traversal = relative(root, absolutePath);
    if (traversal.split(/[\\/]/)[0] === ".." || isAbsolute(traversal)) {
      errors.push(`${label} escapes the workspace`);
      return null;
    }
    try {
      const canonicalPath = await realpath(absolutePath);
      const expectedCanonicalPath = resolve(canonicalRoot, path);
      const canonicalTraversal = relative(canonicalRoot, canonicalPath);
      if (canonicalTraversal.split(/[\\/]/)[0] === ".." || isAbsolute(canonicalTraversal) || canonicalPath !== expectedCanonicalPath) {
        errors.push(`${label} resolves through a symbolic link or outside the workspace`);
        return null;
      }
      const bytes = await readFile(canonicalPath);
      if (bytes.length === 0) {
        errors.push(`${label} is empty`);
        return null;
      }
      let value: unknown = null;
      if (path.endsWith(".json")) {
        try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
        catch { errors.push(`${label} is not valid JSON`); return null; }
      }
      return { bytes, value };
    } catch {
      errors.push(`${label} is missing or unreadable`);
      return null;
    }
  };
  const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
  const expectedGraphs = new Map(compileAllSectionPageFixtures().map((page) => {
    const graph = compileCompletePageGraph(page);
    return [graph.category, { graph, bytes: Buffer.from(JSON.stringify(graph)) }] as const;
  }));
  const releaseProfile = isRecord(receipt.releaseProfile) ? receipt.releaseProfile : null;
  const profile = await readArtifact("fixtures/v2/release-profiles/premium.json", "release profile");
  if (profile && releaseProfile?.sha256 !== sha256(profile.bytes)) errors.push("release profile bytes do not match receipt SHA-256");
  const profileValue = isRecord(profile?.value) ? profile.value : null;
  if (!profileValue || !releaseProfile || !["schema", "id", "premiumQualityThreshold", "originalitySimilarityThreshold", "requiredViewports", "requireExactEvidenceBinding"].every((key) => JSON.stringify(profileValue[key]) === JSON.stringify(releaseProfile[key]))) errors.push("release profile fields do not match governed profile bytes");

  const generatedReceiptArtifact = await readArtifact("artifacts/generated-pages/generated-page-browser-receipt.json", "generated-page browser receipt");
  const tokenReceiptArtifact = await readArtifact("artifacts/v2/semantic-design-tokens/receipt.json", "semantic-token receipt");
  const visualReceiptArtifact = await readArtifact("artifacts/v2/visual-direction-search/receipt.json", "visual-direction receipt");
  const generatedReceipt = isRecord(generatedReceiptArtifact?.value) ? generatedReceiptArtifact.value : null;
  const tokenReceipt = isRecord(tokenReceiptArtifact?.value) ? tokenReceiptArtifact.value : null;
  const visualReceipt = isRecord(visualReceiptArtifact?.value) ? visualReceiptArtifact.value : null;
  if (!generatedReceipt || generatedReceipt.schema !== "website-design-compiler/generated-page-browser-receipt/v2" || generatedReceipt.overall !== "PASS") errors.push("generated-page browser receipt is not PASS evidence");
  const receiptGit = isRecord(receipt.git) ? receipt.git : null;
  const generatedGit = isRecord(generatedReceipt?.git) ? generatedReceipt.git : null;
  if (!generatedGit || generatedGit.sha !== receiptGit?.sha || generatedGit.ref !== receiptGit?.ref) errors.push("generated-page browser receipt is not bound to the premium subject");
  if (generatedReceiptArtifact && generatedReceipt) {
    errors.push(...await validateTrustedGeneratedPageBrowserAdmission(root, generatedReceiptArtifact.bytes, generatedReceipt, {
      sha: String(receiptGit?.sha ?? ""),
      ref: String(receiptGit?.ref ?? "")
    }));
  } else {
    errors.push("trusted generated-page browser admission is absent");
  }
  if (!tokenReceipt || tokenReceipt.schema !== "website-design-compiler/semantic-token-benchmark-receipt/v2" || tokenReceipt.overall !== "PASS") errors.push("semantic-token receipt is not PASS evidence");
  if (!visualReceipt || visualReceipt.schema !== "website-design-compiler/visual-direction-benchmark-receipt/v2" || visualReceipt.overall !== "PASS") errors.push("visual-direction receipt is not PASS evidence");

  const premium = isRecord(receipt.premium) ? receipt.premium : null;
  const evaluations = Array.isArray(premium?.evaluations) ? premium.evaluations : [];
  for (const [index, evaluationValue] of evaluations.entries()) {
    if (!isRecord(evaluationValue)) continue;
    const card = isRecord(evaluationValue.card) ? evaluationValue.card : null;
    const binding = isRecord(evaluationValue.binding) ? evaluationValue.binding : null;
    const source = isRecord(evaluationValue.source) ? evaluationValue.source : null;
    if (!card || !binding || !source) continue;
    const label = `premium.evaluations[${index}]`;
    if (source.generatedPageReceiptPath !== "artifacts/generated-pages/generated-page-browser-receipt.json" || source.semanticTokenReceiptPath !== "artifacts/v2/semantic-design-tokens/receipt.json" || source.visualDirectionReceiptPath !== "artifacts/v2/visual-direction-search/receipt.json") errors.push(`${label}.source changes a governed receipt path`);

    const graph = await readArtifact(source.pageGraphPath, `${label}.pageGraph`);
    const graphValue = isRecord(graph?.value) ? graph.value : null;
    const expectedGraph = typeof card.category === "string" ? expectedGraphs.get(card.category) : undefined;
    if (source.pageGraphPath !== `artifacts/v2/design-quality/page-graphs/${String(card.category)}.json`) errors.push(`${label}.pageGraph path is not canonical`);
    if (graph && sha256(graph.bytes) !== binding.pageGraphSha256) errors.push(`${label}.pageGraph SHA-256 mismatch`);
    if (!graph || !expectedGraph || !graph.bytes.equals(expectedGraph.bytes)) errors.push(`${label}.pageGraph does not match current compiler output`);
    if (!graphValue || graphValue.schema !== "website-design-compiler/page-graph/v2" || graphValue.category !== card.category || graphValue.signature !== binding.graphSignature || !Array.isArray(graphValue.nodes) || graphValue.nodes.length < 5) errors.push(`${label}.pageGraph identity is invalid`);

    const tokens = await readArtifact(source.tokenPath, `${label}.designTokens`);
    if (typeof source.tokenArtifactId !== "string" || (source.tokenArtifactId !== card.category && !source.tokenArtifactId.startsWith(`${String(card.category)}-`)) || source.tokenPath !== `artifacts/v2/semantic-design-tokens/${String(source.tokenArtifactId)}.json`) errors.push(`${label}.designTokens path is not canonical`);
    if (tokens && sha256(tokens.bytes) !== binding.designTokensSha256) errors.push(`${label}.designTokens SHA-256 mismatch`);
    if (tokens) errors.push(...validatePublishedSchema(tokens.value, "website-design-compiler/semantic-design-tokens/v2").map((error) => `${label}.designTokens ${error}`));

    const screenshot = await readArtifact(binding.screenshotPath, `${label}.screenshot`);
    if (screenshot && sha256(screenshot.bytes) !== binding.screenshotSha256) errors.push(`${label}.screenshot SHA-256 mismatch`);
    const observation = await readArtifact(source.visualObservationPath, `${label}.visualObservation`);
    if (observation && sha256(observation.bytes) !== source.visualObservationSha256) errors.push(`${label}.visualObservation SHA-256 mismatch`);
    if (observation) errors.push(...validatePublishedSchema(observation.value, "website-design-compiler/generated-page-visual-observation/v1").map((error) => `${label}.visualObservation ${error}`));
    const observationValue = isRecord(observation?.value) ? observation.value : null;
    const expectedProject = card.viewport === "mobile" ? "mobile-chromium" : "desktop-chromium";
    if (!observationValue || observationValue.category !== card.category || observationValue.project !== expectedProject) errors.push(`${label}.visualObservation identity mismatch`);
    const viewport = isRecord(observationValue?.viewport) ? observationValue.viewport : null;
    const canonicalViewport = GENERATED_PAGE_CANONICAL_VIEWPORTS[expectedProject];
    if (!viewport || viewport.width !== canonicalViewport.width || viewport.height !== canonicalViewport.height) {
      errors.push(`${label}.visualObservation does not match the canonical browser viewport`);
    }
    if (screenshot && viewport && typeof viewport.width === "number" && typeof viewport.height === "number") {
      try { assertPngEvidence(screenshot.bytes, { width: viewport.width, maximumWidth: Math.ceil(viewport.width * 4), minimumHeight: viewport.height, viewport: `${String(card.category)}/${String(card.viewport)}` }); }
      catch (error) { errors.push(`${label}.screenshot ${error instanceof Error ? error.message : "failed PNG validation"}`); }
    } else if (screenshot) {
      errors.push(`${label}.screenshot lacks a bound browser viewport`);
    }

    const generatedEvidence = Array.isArray(generatedReceipt?.evidence) ? generatedReceipt.evidence.find((entry) => isRecord(entry) && entry.category === card.category && entry.project === expectedProject) : null;
    if (!isRecord(generatedEvidence) || `artifacts/generated-pages/${String(generatedEvidence.path)}` !== binding.screenshotPath || generatedEvidence.sha256 !== binding.screenshotSha256 || `artifacts/generated-pages/${String(generatedEvidence.observationPath)}` !== source.visualObservationPath || generatedEvidence.observationSha256 !== source.visualObservationSha256) errors.push(`${label} does not match generated-page browser evidence`);
    const tokenEntry = Array.isArray(tokenReceipt?.categories) ? tokenReceipt.categories.find((entry) => isRecord(entry) && entry.id === source.tokenArtifactId) : null;
    if (!isRecord(tokenEntry) || tokenEntry.state !== "PASS") errors.push(`${label} does not match semantic-token evidence`);
    const visualEntry = Array.isArray(visualReceipt?.categories) ? visualReceipt.categories.find((entry) => isRecord(entry) && entry.id === card.category) : null;
    if (!isRecord(visualEntry) || JSON.stringify(visualEntry) !== JSON.stringify(evaluationValue.suppliedReferenceAudit)) errors.push(`${label} does not match visual-direction evidence`);

    if (expectedGraph && observationValue && (card.viewport === "mobile" || card.viewport === "desktop") && releaseProfile && profileValue) {
      const originalityCorpus: OriginalitySubject[] = [...expectedGraphs.values()]
        .filter((candidate) => candidate.graph.category !== expectedGraph.graph.category)
        .map((candidate) => ({ id: candidate.graph.category, signature: candidate.graph.signature }));
      const recomputedCard = evaluateDesignQuality(
        expectedGraph.graph as CompletePageGraph,
        card.viewport as QualityViewport,
        Number(profileValue.premiumQualityThreshold),
        [],
        originalityCorpus,
        Number(profileValue.originalitySimilarityThreshold),
        observationValue as unknown as DesignQualityBrowserObservation
      );
      if (JSON.stringify(recomputedCard) !== JSON.stringify(card)) errors.push(`${label}.card does not match current graph, observation, and profile`);
      const expectedEvidence: ExpectedDesignQualityEvidence = {
        category: expectedGraph.graph.category,
        viewport: card.viewport as QualityViewport,
        pageGraphSha256: String(binding.pageGraphSha256),
        designTokensSha256: String(binding.designTokensSha256),
        screenshotSha256: String(binding.screenshotSha256),
        gitSha: String(receiptGit?.sha),
        graphSignature: expectedGraph.graph.signature
      };
      const recomputedDecision = decidePremiumQuality(recomputedCard, binding as unknown as DesignQualityEvidenceBinding, expectedEvidence, Number(profileValue.premiumQualityThreshold));
      if (JSON.stringify(recomputedDecision) !== JSON.stringify(evaluationValue.decision)) errors.push(`${label}.decision does not match recomputed premium evidence`);
    }
  }
  return errors;
}

async function validatePremiumArtifacts(root:string,receipt:JsonRecord):Promise<string[]>{
  if(receipt.overall!=="PASS")return[];
  const errors:string[]=[];
  let canonicalRoot:string;
  try{canonicalRoot=await realpath(root);}catch{return["release workspace is missing or unreadable"];}
  const readArtifact=async(path:unknown,label:string):Promise<{bytes:Buffer;value:unknown}|null>=>{
    if(typeof path!=="string"||path.length===0||isAbsolute(path)){errors.push(`${label} is not a safe relative path`);return null;}
    const absolute=resolve(root,path);const traversal=relative(root,absolute);
    if(traversal.split(/[\\/]/)[0]===".."||isAbsolute(traversal)){errors.push(`${label} escapes the workspace`);return null;}
    try{
      const canonical=await realpath(absolute);if(canonical!==resolve(canonicalRoot,path)){errors.push(`${label} resolves through a symbolic link or outside the workspace`);return null;}
      const bytes=await readFile(canonical);if(bytes.length===0){errors.push(`${label} is empty`);return null;}
      try{return{bytes,value:path.endsWith(".json")?JSON.parse(bytes.toString("utf8")) as unknown:null};}catch{errors.push(`${label} is not valid JSON`);return null;}
    }catch{errors.push(`${label} is missing or unreadable`);return null;}
  };
  const sha256=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
  const receiptGit=isRecord(receipt.git)?receipt.git:null;

  const profileArtifact=await readArtifact("fixtures/v3/release-profiles/premium.json","release profile");
  const profile=isRecord(profileArtifact?.value)?profileArtifact.value:null;
  const declaredProfile=isRecord(receipt.releaseProfile)?receipt.releaseProfile:null;
  if(!profile||!declaredProfile||JSON.stringify({...profile,sha256:profileArtifact?sha256(profileArtifact.bytes):null})!==JSON.stringify(declaredProfile))errors.push("release profile fields do not match governed v3 profile bytes");

  const projectionArtifact=await readArtifact("apps/site/generated/benchmark-page-graphs.json","production page-graph projection");
  const projection=isRecord(projectionArtifact?.value)?projectionArtifact.value:null;
  const graphs=projection&&isRecord(projection.graphs)?projection.graphs:null;
  const tokens=projection&&isRecord(projection.designTokens)?projection.designTokens:null;
  if(!projection||projection.schema!=="website-design-compiler/site-page-graph-projection/v2"||projection.source!=="production-site-compiler"||!graphs||!tokens)errors.push("production page-graph projection is malformed");

  const generatedArtifact=await readArtifact("artifacts/generated-pages/generated-page-browser-receipt.json","generated-page browser receipt");
  const generated=isRecord(generatedArtifact?.value)?generatedArtifact.value:null;
  const generatedGit=generated&&isRecord(generated.git)?generated.git:null;
  if(!generated||generated.schema!=="website-design-compiler/generated-page-browser-receipt/v3"||generated.overall!=="PASS")errors.push("generated-page browser v3 receipt is not PASS evidence");
  if(!generatedGit||generatedGit.sha!==receiptGit?.sha||generatedGit.ref!==receiptGit?.ref)errors.push("generated-page browser receipt is not bound to the premium subject");
  if(generatedArtifact&&generated)errors.push(...await validateTrustedGeneratedPageBrowserAdmission(root,generatedArtifact.bytes,generated,{sha:String(receiptGit?.sha??""),ref:String(receiptGit?.ref??"")}));else errors.push("trusted generated-page browser admission is absent");

  const calibrationArtifact=await readArtifact("artifacts/v3/design-quality-calibration/design-quality-calibration-receipt.json","design-quality calibration receipt");
  const calibration=isRecord(calibrationArtifact?.value)?calibrationArtifact.value:null;
  const declaredCalibration=isRecord(receipt.calibration)?receipt.calibration:null;
  const calibrationGit=calibration&&isRecord(calibration.git)?calibration.git:null;
  if(!calibration||calibration.schema!=="website-design-compiler/design-quality-calibration-receipt/v2"||calibration.overall!=="PASS"||calibrationGit?.sha!==receiptGit?.sha||calibrationGit?.ref!==receiptGit?.ref)errors.push("design-quality calibration is not exact-subject PASS evidence");
  if(!declaredCalibration||!calibrationArtifact||declaredCalibration.sha256!==sha256(calibrationArtifact.bytes)||declaredCalibration.state!=="PASS"||declaredCalibration.exactObservationSetBound!==true)errors.push("premium receipt does not bind exact calibration bytes");

  const qualityEvidence=generated&&Array.isArray(generated.qualityEvidence)?generated.qualityEvidence.filter(isRecord):[];
  const observations=new Map<string,{observation:DesignQualityBrowserObservation;bytesSha256:string;evidence:JsonRecord}>();
  for(const evidence of qualityEvidence){
    const category=String(evidence.category??"");const viewport=String(evidence.viewport??"");const project=String(evidence.project??"");
    const path=typeof evidence.path==="string"?join("artifacts/generated-pages",evidence.path):"";
    const observed=await readArtifact(path,`quality observation ${category}/${viewport}`);
    if(!observed||sha256(observed.bytes)!==evidence.sha256){errors.push(`quality observation ${category}/${viewport} digest mismatch`);continue;}
    try{await validateAgainstSchema(observed.value,"design-quality-browser-observation.schema.json",root);}catch{errors.push(`quality observation ${category}/${viewport} schema validation failed`);continue;}
    const observation=observed.value as DesignQualityBrowserObservation;
    if(observation.category!==category||observation.viewport!==viewport||observation.project!==project)errors.push(`quality observation ${category}/${viewport} identity mismatch`);
    const screenshot=await readArtifact(observation.screenshot.path,`quality screenshot ${category}/${viewport}`);
    if(!screenshot||sha256(screenshot.bytes)!==observation.screenshot.sha256||observation.screenshot.sha256!==evidence.screenshotSha256){errors.push(`quality screenshot ${category}/${viewport} digest mismatch`);continue;}
    const expectedViewport=GENERATED_PAGE_CANONICAL_VIEWPORTS[project as keyof typeof GENERATED_PAGE_CANONICAL_VIEWPORTS];
    if(!expectedViewport||observation.computed.viewport.width!==expectedViewport.width||observation.computed.viewport.height!==expectedViewport.height)errors.push(`quality observation ${category}/${viewport} does not match the canonical browser viewport`);
    try{assertPngEvidence(screenshot.bytes,{width:observation.computed.viewport.width,maximumWidth:Math.ceil(observation.computed.viewport.width*4),minimumHeight:observation.computed.viewport.height,viewport:`${category}/${viewport}`});}catch(error){errors.push(`quality screenshot ${category}/${viewport} ${error instanceof Error?error.message:"failed PNG validation"}`);}
    observations.set(`${category}:${viewport}`,{observation,bytesSha256:sha256(observed.bytes),evidence});
  }

  const runtimeTokenMatch=(tokenValue:JsonRecord,observation:DesignQualityBrowserObservation):RuntimeTokenMatch=>{
    const color=isRecord(tokenValue.color)?tokenValue.color:{};const typography=isRecord(tokenValue.typography)?tokenValue.typography:{};const display=isRecord(typography.display)?typography.display:{};const body=isRecord(typography.body)?typography.body:{};const layout=isRecord(tokenValue.layout)?tokenValue.layout:{};const container=isRecord(layout.containerMaxPx)?layout.containerMaxPx:{};const gutter=isRecord(layout.gutterPx)?layout.gutterPx:{};const motion=isRecord(tokenValue.motionMs)?tokenValue.motionMs:{};
    const expected:Record<string,string>={"--wdc-color-background":String(color.background??""),"--wdc-color-surface":String(color.surface??""),"--wdc-color-text-primary":String(color.text??""),"--wdc-color-text-muted":String(color.mutedText??""),"--wdc-color-accent":String(color.accent??""),"--wdc-color-on-accent":String(color.onAccent??""),"--wdc-color-focus":String(color.focus??""),"--wdc-font-display":String(display.family??""),"--wdc-font-body":String(body.family??""),"--wdc-motion-fast":`${String(motion.fast??"")}ms`,"--wdc-motion-base":`${String(motion.base??"")}ms`,"--wdc-container-max":`${String(container[observation.viewport]??"")}px`,"--wdc-gutter":`${String(gutter[observation.viewport]??"")}px`};
    const normalize=(value:string)=>value.toLowerCase().replace(/[\s"']/g,"");
    const mismatches=Object.entries(expected).filter(([name,value])=>name.startsWith("--wdc-font-")?!normalize(observation.computed.cssTokens[name]??"").startsWith(normalize(value)):normalize(observation.computed.cssTokens[name]??"")!==normalize(value)).map(([name,value])=>`${name}:${observation.computed.cssTokens[name]??"ABSENT"}!=${value}`);
    return{state:mismatches.length===0?"PASS":"FAIL",matched:Object.keys(expected).length-mismatches.length,total:Object.keys(expected).length,mismatches};
  };

  const graphEntries=Object.entries(graphs??{}).flatMap(([category,value])=>isRecord(value)?[[category,value as unknown as CompletePageGraph] as const]:[]);
  const premium=isRecord(receipt.premium)?receipt.premium:null;const evaluations=Array.isArray(premium?.evaluations)?premium.evaluations:[];
  for(const[index,value]of evaluations.entries()){
    if(!isRecord(value))continue;const card=isRecord(value.card)?value.card:null;const binding=isRecord(value.binding)?value.binding:null;const source=isRecord(value.source)?value.source:null;
    if(!card||!binding||!source||typeof card.category!=="string"||(card.viewport!=="mobile"&&card.viewport!=="desktop"))continue;
    const label=`premium.evaluations[${index}]`;const graph=graphs?.[card.category] as CompletePageGraph|undefined;const tokenValue=tokens&&isRecord(tokens[card.category])?tokens[card.category] as JsonRecord:null;const observed=observations.get(`${card.category}:${card.viewport}`);const project=card.viewport==="mobile"?"mobile-chromium":"desktop-chromium";
    if(!graph||!tokenValue||!observed){errors.push(`${label} lacks current graph, tokens, or browser observation`);continue;}
    if(source.generatedPageReceipt!==generated?.schema||source.generatedPageReceiptGitSha!==generatedGit?.sha||source.productionProjection!==projection?.schema||source.productionProjectionPath!=="apps/site/generated/benchmark-page-graphs.json"||source.productionProjectionSha256!==(projectionArtifact?sha256(projectionArtifact.bytes):null))errors.push(`${label}.source does not bind current upstream receipts and projection`);
    if(source.qualityObservationPath!==observed.evidence.path||source.qualityObservationSha256!==observed.bytesSha256)errors.push(`${label}.source does not bind the exact browser observation`);
    if(binding.pageGraphSha256!==sha256(JSON.stringify(graph))||binding.graphSignature!==graph.signature||binding.designTokensSha256!==sha256(JSON.stringify(tokenValue))||binding.screenshotPath!==observed.observation.screenshot.path||binding.screenshotSha256!==observed.observation.screenshot.sha256||binding.gitSha!==receiptGit?.sha)errors.push(`${label}.binding does not match current graph, tokens, screenshot, and Git subject`);
    if(observed.evidence.project!==project)errors.push(`${label}.browser project is not canonical for its viewport`);
    const structuralIds=graphEntries.filter(([category])=>category!==card.category).map(([category])=>category).sort();const visualIds=[...observations.values()].map((entry)=>entry.observation).filter((entry)=>entry.viewport===card.viewport&&entry.category!==card.category).map((entry)=>entry.category).sort();
    if(JSON.stringify([...(Array.isArray(source.structuralOriginalityCorpus)?source.structuralOriginalityCorpus:[])].sort())!==JSON.stringify(structuralIds)||JSON.stringify([...(Array.isArray(source.visualOriginalityCorpus)?source.visualOriginalityCorpus:[])].sort())!==JSON.stringify(visualIds))errors.push(`${label}.originality corpus identities drifted`);
    const visualCorpus:VisualOriginalitySubject[]=[...observations.values()].map((entry)=>entry.observation).filter((entry)=>entry.viewport===card.viewport&&entry.category!==card.category).map((observation)=>({id:observation.category,observation}));
    const recomputed=evaluateDesignQualityV3(graph,card.viewport as QualityViewport,{premiumQualityThreshold:Number(profile?.premiumQualityThreshold),originalitySimilarityThreshold:Number(profile?.originalitySimilarityThreshold),structuralCorpus:graphEntries.filter(([category])=>category!==card.category).map(([category,candidate])=>({id:category,graph:candidate})),observation:observed.observation,tokenMatch:runtimeTokenMatch(tokenValue,observed.observation),visualCorpus});
    if(JSON.stringify(recomputed)!==JSON.stringify(card))errors.push(`${label}.card does not match current graph, observation, tokens, corpus, and profile`);
    const expected:ExpectedDesignQualityEvidence={category:graph.category,viewport:card.viewport as QualityViewport,pageGraphSha256:String(binding.pageGraphSha256),designTokensSha256:String(binding.designTokensSha256),screenshotSha256:String(binding.screenshotSha256),gitSha:String(receiptGit?.sha),graphSignature:graph.signature};
    const decision=decidePremiumQuality(recomputed,binding as unknown as DesignQualityEvidenceBinding,expected,Number(profile?.premiumQualityThreshold));
    if(JSON.stringify(decision)!==JSON.stringify(value.decision))errors.push(`${label}.decision does not match recomputed premium evidence`);
  }

  const calibrationSources=calibration&&isRecord(calibration.sources)?calibration.sources:null;const calibrationProjection=calibrationSources&&isRecord(calibrationSources.projection)?calibrationSources.projection:null;const calibrationObservations=calibrationSources&&Array.isArray(calibrationSources.observations)?calibrationSources.observations.filter(isRecord):[];
  const observedSet=[...observations.values()].map((entry)=>`${entry.observation.category}:${entry.observation.viewport}:${entry.bytesSha256}:${entry.observation.screenshot.sha256}`).sort();const calibratedSet=calibrationObservations.map((entry)=>`${String(entry.category)}:${String(entry.viewport)}:${String(entry.sha256)}:${String(entry.screenshotSha256)}`).sort();
  if(calibrationProjection?.sha256!==(projectionArtifact?sha256(projectionArtifact.bytes):null)||JSON.stringify(observedSet)!==JSON.stringify(calibratedSet))errors.push("calibration does not bind the exact production projection and browser observation set");
  return errors;
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
      const receipt = JSON.parse(bytes.toString("utf8")) as unknown;
      const binding = bindReleaseEvidenceStructure(receipt, expectedSchema, expectedGit);
      const runtimeArtifactErrors = expectedSchema === "website-design-compiler/runtime-receipt/v1" && isRecord(receipt)
        ? await validateRuntimeArtifacts(root, path, receipt)
        : [];
      const premiumArtifactErrors = expectedSchema === "website-design-compiler/design-quality-eval-receipt/v3" && isRecord(receipt)
        ? await validatePremiumArtifacts(root, receipt)
        : [];
      const providerArtifactErrors=expectedSchema==="website-design-compiler/production-provider-status/v2"&&isRecord(receipt)
        ?await validateProductionProviderArtifacts(root,receipt)
        :[];
      const errors = [...binding.errors, ...runtimeArtifactErrors, ...premiumArtifactErrors,...providerArtifactErrors];
      return { ...binding, state: errors.length === 0 ? binding.state : "FAIL", errors, path, sha256 };
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

function capabilityEvidenceState(value: unknown, capability: Capability): CapabilityState {
  if (EVIDENCE_STATES.has(value)) return value as CapabilityState;
  throw new Error(`${capability} receipt has invalid overall state`);
}

export async function readCapabilityEvidence(root: string, capability: Capability): Promise<CapabilityEvidence> {
  const contract = CAPABILITY_RECEIPT_CONTRACTS[capability];
  let bytes: Buffer;
  try {
    bytes = await readFile(join(root, contract.path));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { state: "ABSENT", gitSha: null, identity: null, artifactPath: contract.path, artifactSha256: null };
    }
    throw new Error(`unable to read ${capability} receipt`, { cause: error });
  }
  let receipt: unknown;
  try { receipt = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch (error) { throw new Error(`${capability} receipt is malformed JSON`, { cause: error }); }
  await validateAgainstSchema(receipt, contract.schemaFile, root);
  if (!isRecord(receipt)) throw new Error(`${capability} receipt must be an object`);
  if (receipt.schema !== contract.identity) throw new Error(`${capability} receipt schema identity mismatch`);
  const git = isRecord(receipt.git) ? receipt.git : null;
  if (!git || typeof git.sha !== "string" || !GIT_SHA.test(git.sha)) throw new Error(`${capability} receipt has no exact git SHA`);
  if(typeof git.ref!=="string"||!git.ref.startsWith("refs/"))throw new Error(`${capability} receipt has no exact git ref`);
  const structural=bindReleaseEvidenceStructure(receipt,contract.identity,{sha:git.sha,ref:git.ref});
  const artifactErrors=capability==="productionProvider"
    ?await validateProductionProviderArtifacts(root,receipt)
    :capability==="premiumQuality"
      ?await validatePremiumArtifacts(root,receipt)
      :[];
  const state=structural.errors.length===0&&artifactErrors.length===0?capabilityEvidenceState(receipt.overall,capability):"FAIL";
  return {
    state,
    gitSha: git.sha,
    identity: contract.identity,
    artifactPath: contract.path,
    artifactSha256: createHash("sha256").update(bytes).digest("hex")
  };
}
