export type QualityGateState = "PASS" | "FAIL" | "NOT_EXERCISED";

export interface ReleaseBudgets {
  schema: "website-design-compiler/release-budgets/v1";
  version: number;
  hardGates: {
    axeSeriousCriticalViolations: number;
    mainLandmarks: number;
    h1Count: number;
    touchTargetMinCssPx: number;
    lcpMaxMs: number;
    clsMax: number;
    ttfbMaxMs: number;
    inpMaxMs: number;
    totalTransferMaxBytes: number;
    scriptTransferMaxBytes: number;
    imageTransferMaxBytes: number;
    videoTransferMaxBytes: number;
    domNodesMax: number;
    graphics2dExternalAssetMaxBytes: number;
    graphics3dExternalAssetMaxBytes: number;
    graphics3dTextureAssetMaxBytes: number;
    graphics3dMaxTriangles: number;
    graphics3dMaxDrawCalls: number;
  };
  requiredStates: string[];
  requiredProjects: string[];
  requiredDegradationPaths: string[];
  exceptions: Array<{ id: string; gate: string; reason: string; expiresAt?: string }>;
}

export interface QualityMeasurements {
  axeSeriousCriticalViolations: number;
  fallbackAxeSeriousCriticalViolations: number | null;
  mainLandmarks: number;
  h1Count: number;
  minTouchTargetPx: number;
  lcpMs: number;
  cls: number;
  ttfbMs: number;
  inpMs: number | null;
  totalTransferBytes: number;
  scriptTransferBytes: number;
  imageTransferBytes: number;
  videoTransferBytes: number;
  domNodes: number;
  states: string[];
  reducedMotionVerified: boolean;
  coarsePointerVerified: boolean;
  graphics2dFallbackVerified: boolean;
  graphics3dFallbackVerified: boolean;
  graphics2dExternalAssetBytes: number;
  graphics3dExternalAssetBytes: number;
  graphics3dTextureAssetBytes: number;
  graphics3dMaxTriangles: number;
  graphics3dMaxDrawCalls: number;
}

export interface QualityEvaluation {
  overall: "PASS" | "FAIL";
  gates: Record<string, QualityGateState>;
}

export function evaluateQualityMeasurements(
  measurements: QualityMeasurements,
  budgets: ReleaseBudgets
): QualityEvaluation {
  const hard = budgets.hardGates;
  const gates: Record<string, QualityGateState> = {
    axe: measurements.axeSeriousCriticalViolations <= hard.axeSeriousCriticalViolations ? "PASS" : "FAIL",
    fallbackAxe: measurements.fallbackAxeSeriousCriticalViolations === null
      ? "NOT_EXERCISED"
      : measurements.fallbackAxeSeriousCriticalViolations <= hard.axeSeriousCriticalViolations ? "PASS" : "FAIL",
    mainLandmark: measurements.mainLandmarks === hard.mainLandmarks ? "PASS" : "FAIL",
    h1: measurements.h1Count === hard.h1Count ? "PASS" : "FAIL",
    touchTargets: measurements.minTouchTargetPx >= hard.touchTargetMinCssPx ? "PASS" : "FAIL",
    lcp: measurements.lcpMs > 0 && measurements.lcpMs <= hard.lcpMaxMs ? "PASS" : "FAIL",
    cls: measurements.cls <= hard.clsMax ? "PASS" : "FAIL",
    ttfb: measurements.ttfbMs >= 0 && measurements.ttfbMs <= hard.ttfbMaxMs ? "PASS" : "FAIL",
    inp: measurements.inpMs === null ? "NOT_EXERCISED" : measurements.inpMs <= hard.inpMaxMs ? "PASS" : "FAIL",
    totalTransfer: measurements.totalTransferBytes <= hard.totalTransferMaxBytes ? "PASS" : "FAIL",
    scriptTransfer: measurements.scriptTransferBytes <= hard.scriptTransferMaxBytes ? "PASS" : "FAIL",
    imageTransfer: measurements.imageTransferBytes <= hard.imageTransferMaxBytes ? "PASS" : "FAIL",
    videoTransfer: measurements.videoTransferBytes <= hard.videoTransferMaxBytes ? "PASS" : "FAIL",
    domNodes: measurements.domNodes <= hard.domNodesMax ? "PASS" : "FAIL",
    explicitStates: budgets.requiredStates.every((state) => measurements.states.includes(state)) ? "PASS" : "FAIL",
    reducedMotion: measurements.reducedMotionVerified ? "PASS" : "FAIL",
    coarsePointer: measurements.coarsePointerVerified ? "PASS" : "FAIL",
    graphics2dFallback: measurements.graphics2dFallbackVerified ? "PASS" : "FAIL",
    graphics3dFallback: measurements.graphics3dFallbackVerified ? "PASS" : "FAIL",
    graphics2dAssetBudget: measurements.graphics2dExternalAssetBytes <= hard.graphics2dExternalAssetMaxBytes ? "PASS" : "FAIL",
    graphics3dAssetBudget: measurements.graphics3dExternalAssetBytes <= hard.graphics3dExternalAssetMaxBytes && measurements.graphics3dTextureAssetBytes <= hard.graphics3dTextureAssetMaxBytes ? "PASS" : "FAIL",
    graphics3dComplexity: measurements.graphics3dMaxTriangles <= hard.graphics3dMaxTriangles && measurements.graphics3dMaxDrawCalls <= hard.graphics3dMaxDrawCalls ? "PASS" : "FAIL"
  };

  return {
    overall: Object.values(gates).some((state) => state === "FAIL") ? "FAIL" : "PASS",
    gates
  };
}
