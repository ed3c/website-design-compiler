export type ReleaseInputState = "PASS" | "FAIL" | "NOT_IMPLEMENTED" | "NOT_EXERCISED" | "ABSENT" | "SKIPPED_BY_POLICY";

export interface ReleaseEvidenceBinding {
  state: ReleaseInputState;
  binding: "BOUND" | "MISMATCH" | "ABSENT";
  schema: string | null;
  git: { sha: string; ref: string } | null;
  errors: string[];
}

export function bindReleaseEvidence(
  receipt: unknown,
  expectedSchema: string,
  expectedGit: { sha: string; ref: string }
): ReleaseEvidenceBinding {
  if (!receipt || typeof receipt !== "object") {
    return { state: "ABSENT", binding: "ABSENT", schema: null, git: null, errors: ["receipt is absent"] };
  }
  const value = receipt as { schema?: unknown; overall?: unknown; git?: { sha?: unknown; ref?: unknown } };
  const errors: string[] = [];
  if (value.schema !== expectedSchema) errors.push(`schema must be ${expectedSchema}`);
  const state = value.overall;
  const validState = state === "PASS" || state === "FAIL" || state === "NOT_IMPLEMENTED" || state === "NOT_EXERCISED" || state === "ABSENT" || state === "SKIPPED_BY_POLICY";
  if (!validState) errors.push("overall evidence state is invalid");
  const git = typeof value.git?.sha === "string" && typeof value.git.ref === "string"
    ? { sha: value.git.sha, ref: value.git.ref }
    : null;
  const binding = git === null ? "ABSENT" : git.sha === expectedGit.sha && git.ref === expectedGit.ref ? "BOUND" : "MISMATCH";
  if (binding !== "BOUND") errors.push(`git binding is ${binding}`);
  return {
    state: errors.length === 0 ? state as ReleaseInputState : "FAIL",
    binding,
    schema: typeof value.schema === "string" ? value.schema : null,
    git,
    errors
  };
}

export interface ReleaseGateInputs {
  runtime: ReleaseInputState;
  browser: ReleaseInputState;
  accessibilityPerformance: ReleaseInputState;
  storybook: ReleaseInputState;
  sharedBindings: ReleaseInputState;
  arena: ReleaseInputState;
  showcase: ReleaseInputState;
  externalSkills: ReleaseInputState;
  mediaGenerator: ReleaseInputState;
  authoringStudio: ReleaseInputState;
  payloadCms: ReleaseInputState;
  repositoryRights: ReleaseInputState;
}

export interface ReleaseGateEvaluation {
  schema: "website-design-compiler/release-gate-evaluation/v1";
  overall: "PASS" | "FAIL";
  gates: ReleaseGateInputs;
}

export function evaluateReleaseGate(inputs: ReleaseGateInputs): ReleaseGateEvaluation {
  return {
    schema: "website-design-compiler/release-gate-evaluation/v1",
    overall: Object.values(inputs).every((state) => state === "PASS") ? "PASS" : "FAIL",
    gates: inputs
  };
}
