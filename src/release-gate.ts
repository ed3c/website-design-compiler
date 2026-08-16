export type ReleaseInputState = "PASS" | "FAIL" | "NOT_IMPLEMENTED" | "NOT_EXERCISED" | "ABSENT" | "SKIPPED_BY_POLICY";

export interface ReleaseGateInputs {
  runtime: ReleaseInputState;
  browser: ReleaseInputState;
  accessibilityPerformance: ReleaseInputState;
  storybook: ReleaseInputState;
  sharedBindings: ReleaseInputState;
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
