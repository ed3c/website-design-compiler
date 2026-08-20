import { createHash } from "node:crypto";
import { validateCompletePageGraph, type CompletePageGraph } from "../complete-page-graph.js";
import { pageGraphFingerprint } from "../page-graph-roundtrip.js";

export type ConstraintSeverity = "HARD" | "SOFT";
export type ConstraintState = "SATISFIED" | "UNSATISFIED" | "NOT_EVALUATED";
export type HardConstraintState = "PASS" | "FAIL" | "BLOCKED";
export type SoftConstraintState = "PASS" | "FAIL" | "NOT_EVALUATED";
export type ConstraintClass =
  | "SEMANTIC"
  | "CONTENT"
  | "PROVENANCE"
  | "ACCESSIBILITY"
  | "RESPONSIVE"
  | "RIGHTS"
  | "DESIGN_QUALITY";

export interface ConstraintFinding {
  id: string;
  class: ConstraintClass;
  severity: ConstraintSeverity;
  state: ConstraintState;
  diagnostics: string[];
}

export interface SoftDesignQualityEvidence {
  state: "PASS" | "FAIL";
  evidenceSha256: string;
  diagnostics?: readonly string[];
}

export interface PageGraphConstraintReport {
  schema: "website-design-compiler/page-graph-constraint-report/v1";
  graphDigest: string;
  findings: ConstraintFinding[];
  hardState: HardConstraintState;
  softState: SoftConstraintState;
  reportIdentitySha256: string;
}

export type DeterministicOutcome = "PASS" | "FAIL" | "NEEDS_INPUT" | "AMBIGUOUS";

export interface SolverBenchmarkCase {
  caseId: string;
  decisionVariableCount: number;
  feasibleCandidateCount: number;
  hardConstraintsSatisfied: boolean;
  softObjectiveCount: number;
  deterministicPassCanSelect: boolean;
  deterministicOutcome: DeterministicOutcome;
  evidenceSha256: string;
}

export interface SolverAdmissionDecision {
  schema: "website-design-compiler/solver-admission-decision/v1";
  criteriaVersion: "solver-admission-criteria/v1";
  criteriaIdentitySha256: string;
  caseSetSha256: string;
  state: "NOT_REQUIRED_FOR_CURRENT_CASESET" | "REQUIRED_NOT_ADMITTED";
  triggeredCaseIds: string[];
  solverAdapterState: "NOT_ADMITTED";
  rationale: string;
  decisionIdentitySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SOLVER_CRITERIA = {
  schema: "website-design-compiler/solver-admission-criteria/v1",
  minimumDecisionVariables: 2,
  minimumFeasibleCandidates: 2,
  minimumSoftObjectives: 1,
  requiresHardConstraintsSatisfied: true,
  requiresDeterministicAmbiguity: true,
  rule: "search-is-required-only-when-current-deterministic-passes-cannot-select-among-multiple-hard-valid-candidates"
} as const;

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("constraint evidence cannot contain non-finite numbers");
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
  throw new Error(`constraint canonical JSON does not support ${typeof value}`);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function exactSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function stableId(value: string, field: string): string {
  const normalized = value.trim();
  if (!STABLE_ID.test(normalized)) throw new Error(`${field} must be a stable lowercase identifier`);
  return normalized;
}

function diagnosticLines(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => {
    const normalized = value.trim();
    if (!normalized || /[\u0000\r\n]/.test(normalized)) throw new Error("constraint diagnostics must be non-empty public-safe lines");
    return normalized;
  }))].sort();
}

function finding(
  id: string,
  className: ConstraintClass,
  severity: ConstraintSeverity,
  state: ConstraintState,
  diagnostics: readonly string[] = []
): ConstraintFinding {
  return {
    id: stableId(id, "constraint id"),
    class: className,
    severity,
    state,
    diagnostics: diagnosticLines(diagnostics)
  };
}

function hardState(findings: readonly ConstraintFinding[]): HardConstraintState {
  const hard = findings.filter((entry) => entry.severity === "HARD");
  if (hard.some((entry) => entry.state === "UNSATISFIED")) return "FAIL";
  if (hard.some((entry) => entry.state === "NOT_EVALUATED")) return "BLOCKED";
  return "PASS";
}

function softState(findings: readonly ConstraintFinding[]): SoftConstraintState {
  const soft = findings.filter((entry) => entry.severity === "SOFT");
  if (soft.length === 0 || soft.every((entry) => entry.state === "NOT_EVALUATED")) return "NOT_EVALUATED";
  if (soft.some((entry) => entry.state === "UNSATISFIED")) return "FAIL";
  return "PASS";
}

export function evaluatePageGraphConstraints(
  graph: CompletePageGraph,
  designQuality?: SoftDesignQualityEvidence
): PageGraphConstraintReport {
  const structuralErrors = validateCompletePageGraph(graph);
  const semanticOrderOk = graph.semanticOrder.join("|") === graph.nodes.map((node) => node.id).join("|")
    && graph.nodes.every((node, index) => node.semanticIndex === index);
  const chromeOk = graph.nodes[0]?.kind === "navigation" && graph.nodes.at(-1)?.kind === "footer";
  const provenanceOk = graph.missingEvidence.length === 0 && graph.readiness === "READY";
  const responsiveOk = graph.nodes.every((node) => node.responsive.semanticOrder === "DOM_STABLE");
  const arbitraryMarkupBlocked = graph.contracts.arbitraryMarkupAllowed === false;

  const findings: ConstraintFinding[] = [
    finding(
      "graph-existing-invariants",
      "SEMANTIC",
      "HARD",
      structuralErrors.length === 0 ? "SATISFIED" : "UNSATISFIED",
      structuralErrors
    ),
    finding(
      "semantic-order-and-chrome",
      "SEMANTIC",
      "HARD",
      semanticOrderOk && chromeOk ? "SATISFIED" : "UNSATISFIED",
      [
        ...(!semanticOrderOk ? ["semantic order or contiguous semantic indices drifted"] : []),
        ...(!chromeOk ? ["navigation must remain first and footer must remain last in semantic DOM order"] : [])
      ]
    ),
    finding(
      "source-provenance-completeness",
      "PROVENANCE",
      "HARD",
      provenanceOk ? "SATISFIED" : "UNSATISFIED",
      provenanceOk ? [] : [`graph remains ${graph.readiness} with ${graph.missingEvidence.length} named missing-evidence entries`]
    ),
    finding(
      "responsive-dom-stability",
      "ACCESSIBILITY",
      "HARD",
      responsiveOk ? "SATISFIED" : "UNSATISFIED",
      responsiveOk ? [] : ["one or more responsive policies do not preserve DOM_STABLE semantic order"]
    ),
    finding(
      "arbitrary-markup-boundary",
      "CONTENT",
      "HARD",
      arbitraryMarkupBlocked ? "SATISFIED" : "UNSATISFIED",
      arbitraryMarkupBlocked ? [] : ["arbitrary markup escape hatch is enabled"]
    ),
    finding(
      "release-rights-boundary",
      "RIGHTS",
      "HARD",
      "NOT_EVALUATED",
      ["page-graph/v2 does not embed canonical repository/model/output/service rights receipts; release rights remain an external hard gate"]
    ),
    designQuality
      ? finding(
          "design-quality-objective",
          "DESIGN_QUALITY",
          "SOFT",
          designQuality.state === "PASS" ? "SATISFIED" : "UNSATISFIED",
          designQuality.state === "PASS" ? [] : diagnosticLines(designQuality.diagnostics ?? ["design-quality evidence failed"])
        )
      : finding(
          "design-quality-objective",
          "DESIGN_QUALITY",
          "SOFT",
          "NOT_EVALUATED",
          ["soft design-quality evidence was not supplied to this constraint report"]
        )
  ];

  if (designQuality) exactSha256(designQuality.evidenceSha256, "designQuality.evidenceSha256");
  const stable = {
    schema: "website-design-compiler/page-graph-constraint-report/v1" as const,
    graphDigest: pageGraphFingerprint(graph),
    findings,
    hardState: hardState(findings),
    softState: softState(findings)
  };
  return { ...stable, reportIdentitySha256: digest(stable) };
}

export function introducedHardConstraintFailures(
  before: PageGraphConstraintReport,
  after: PageGraphConstraintReport
): string[] {
  const beforeById = new Map(before.findings.filter((entry) => entry.severity === "HARD").map((entry) => [entry.id, entry]));
  return after.findings
    .filter((entry) => entry.severity === "HARD" && entry.state === "UNSATISFIED" && beforeById.get(entry.id)?.state !== "UNSATISFIED")
    .map((entry) => entry.id)
    .sort();
}

function normalizeBenchmarkCase(input: SolverBenchmarkCase): SolverBenchmarkCase {
  const nonNegative = (value: number, field: string): number => {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
    return value;
  };
  if (!["PASS", "FAIL", "NEEDS_INPUT", "AMBIGUOUS"].includes(input.deterministicOutcome)) {
    throw new Error("deterministicOutcome is invalid");
  }
  return {
    caseId: stableId(input.caseId, "caseId"),
    decisionVariableCount: nonNegative(input.decisionVariableCount, "decisionVariableCount"),
    feasibleCandidateCount: nonNegative(input.feasibleCandidateCount, "feasibleCandidateCount"),
    hardConstraintsSatisfied: input.hardConstraintsSatisfied,
    softObjectiveCount: nonNegative(input.softObjectiveCount, "softObjectiveCount"),
    deterministicPassCanSelect: input.deterministicPassCanSelect,
    deterministicOutcome: input.deterministicOutcome,
    evidenceSha256: exactSha256(input.evidenceSha256, "evidenceSha256")
  };
}

function requiresSearch(entry: SolverBenchmarkCase): boolean {
  return entry.decisionVariableCount >= SOLVER_CRITERIA.minimumDecisionVariables
    && entry.feasibleCandidateCount >= SOLVER_CRITERIA.minimumFeasibleCandidates
    && entry.hardConstraintsSatisfied
    && entry.softObjectiveCount >= SOLVER_CRITERIA.minimumSoftObjectives
    && !entry.deterministicPassCanSelect
    && entry.deterministicOutcome === "AMBIGUOUS";
}

export function decideSolverAdmission(cases: readonly SolverBenchmarkCase[]): SolverAdmissionDecision {
  if (cases.length === 0) throw new Error("solver admission requires at least one benchmark case");
  const normalized = cases.map(normalizeBenchmarkCase).sort((left, right) => left.caseId.localeCompare(right.caseId));
  const ids = new Set<string>();
  for (const entry of normalized) {
    if (ids.has(entry.caseId)) throw new Error(`duplicate solver benchmark case: ${entry.caseId}`);
    ids.add(entry.caseId);
  }
  const triggeredCaseIds = normalized.filter(requiresSearch).map((entry) => entry.caseId);
  const state = triggeredCaseIds.length > 0 ? "REQUIRED_NOT_ADMITTED" as const : "NOT_REQUIRED_FOR_CURRENT_CASESET" as const;
  const criteriaIdentitySha256 = digest(SOLVER_CRITERIA);
  const caseSetSha256 = digest(normalized);
  const stable = {
    schema: "website-design-compiler/solver-admission-decision/v1" as const,
    criteriaVersion: "solver-admission-criteria/v1" as const,
    criteriaIdentitySha256,
    caseSetSha256,
    state,
    triggeredCaseIds,
    solverAdapterState: "NOT_ADMITTED" as const,
    rationale: state === "REQUIRED_NOT_ADMITTED"
      ? "At least one benchmark has multiple hard-valid alternatives plus a measurable soft objective that current deterministic passes cannot select; an exact solver technology must be admitted before execution."
      : "Current benchmark cases are deterministically decidable or fail as NEEDS_INPUT; no generic solver dependency is justified by measured evidence."
  };
  return { ...stable, decisionIdentitySha256: digest(stable) };
}

export function createDeterministicTextFitCase(
  caseId: string,
  text: string,
  maxCharacters: number,
  evidenceSha256: string
): SolverBenchmarkCase {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new Error("maxCharacters must be a positive integer");
  const value = text.trim();
  if (!value) throw new Error("text-fit benchmark requires non-empty text");
  const fits = value.length <= maxCharacters;
  return normalizeBenchmarkCase({
    caseId,
    decisionVariableCount: 1,
    feasibleCandidateCount: fits ? 1 : 0,
    hardConstraintsSatisfied: fits,
    softObjectiveCount: 0,
    deterministicPassCanSelect: true,
    deterministicOutcome: fits ? "PASS" : "NEEDS_INPUT",
    evidenceSha256
  });
}
