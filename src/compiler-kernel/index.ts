import { createHash } from "node:crypto";
import type { CompletePageGraph } from "../complete-page-graph.js";
import {
  evaluatePageGraphConstraints,
  introducedHardConstraintFailures,
  type PageGraphConstraintReport,
  type SoftDesignQualityEvidence
} from "./constraint-model.js";
import {
  applyPageGraphPatch,
  type PageGraphPatch,
  type PageGraphPatchApplication,
  type PageGraphPatchInput,
  type PatchHistoryContext
} from "./page-graph-patch.js";

export * from "./page-graph-patch.js";
export * from "./constraint-model.js";

export type CompilerKernelPatchState = "APPLIED" | "CONFLICT" | "REJECTED" | "HARD_CONSTRAINT_REJECTED";

export interface CompilerKernelPatchReceipt {
  schema: "website-design-compiler/compiler-kernel-patch-receipt/v1";
  state: CompilerKernelPatchState;
  patchReceiptIdentitySha256: string;
  beforeConstraintReportIdentitySha256: string;
  afterConstraintReportIdentitySha256: string | null;
  introducedHardFailures: string[];
  resultDigest: string | null;
  receiptIdentitySha256: string;
}

export interface CompilerKernelPatchApplication {
  graph: CompletePageGraph | null;
  patchApplication: PageGraphPatchApplication;
  beforeConstraints: PageGraphConstraintReport;
  afterConstraints: PageGraphConstraintReport | null;
  receipt: CompilerKernelPatchReceipt;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("compiler-kernel receipt cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error(`compiler-kernel canonical JSON does not support ${typeof value}`);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function receiptFor(
  state: CompilerKernelPatchState,
  patchApplication: PageGraphPatchApplication,
  beforeConstraints: PageGraphConstraintReport,
  afterConstraints: PageGraphConstraintReport | null,
  introducedHardFailures: readonly string[]
): CompilerKernelPatchReceipt {
  const stable = {
    schema: "website-design-compiler/compiler-kernel-patch-receipt/v1" as const,
    state,
    patchReceiptIdentitySha256: patchApplication.receipt.receiptIdentitySha256,
    beforeConstraintReportIdentitySha256: beforeConstraints.reportIdentitySha256,
    afterConstraintReportIdentitySha256: afterConstraints?.reportIdentitySha256 ?? null,
    introducedHardFailures: [...new Set(introducedHardFailures)].sort(),
    resultDigest: state === "APPLIED" ? patchApplication.receipt.resultDigest : null
  };
  return { ...stable, receiptIdentitySha256: digest(stable) };
}

export function applyCompilerKernelPatch(
  baseGraph: CompletePageGraph,
  patch: PageGraphPatchInput | PageGraphPatch,
  history?: PatchHistoryContext,
  designQuality?: SoftDesignQualityEvidence
): CompilerKernelPatchApplication {
  const beforeConstraints = evaluatePageGraphConstraints(baseGraph, designQuality);
  const patchApplication = applyPageGraphPatch(baseGraph, patch, history);

  if (patchApplication.graph === null) {
    const state: CompilerKernelPatchState = patchApplication.receipt.state === "CONFLICT" ? "CONFLICT" : "REJECTED";
    return {
      graph: null,
      patchApplication,
      beforeConstraints,
      afterConstraints: null,
      receipt: receiptFor(state, patchApplication, beforeConstraints, null, [])
    };
  }

  const afterConstraints = evaluatePageGraphConstraints(patchApplication.graph, designQuality);
  const introducedHardFailures = introducedHardConstraintFailures(beforeConstraints, afterConstraints);
  if (introducedHardFailures.length > 0) {
    return {
      graph: null,
      patchApplication,
      beforeConstraints,
      afterConstraints,
      receipt: receiptFor(
        "HARD_CONSTRAINT_REJECTED",
        patchApplication,
        beforeConstraints,
        afterConstraints,
        introducedHardFailures
      )
    };
  }

  return {
    graph: patchApplication.graph,
    patchApplication,
    beforeConstraints,
    afterConstraints,
    receipt: receiptFor("APPLIED", patchApplication, beforeConstraints, afterConstraints, [])
  };
}
