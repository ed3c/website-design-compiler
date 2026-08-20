export { bindReleaseEvidence, type ReleaseEvidenceBinding, type ReleaseInputState } from "./release-evidence.js";
import type { ReleaseInputState } from "./release-evidence.js";

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
