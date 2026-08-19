import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeterministicTextFitCase,
  decideSolverAdmission,
  evaluatePageGraphConstraints,
  introducedHardConstraintFailures,
  type SolverBenchmarkCase
} from "../src/compiler-kernel/constraint-model.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { validateAgainstSchema } from "../src/validate.js";

const h = (value: string) => value.repeat(64).slice(0, 64);

function graph() {
  return compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
}

test("page graph constraint report keeps hard release rights explicit instead of borrowing a soft PASS", async () => {
  const report = evaluatePageGraphConstraints(graph(), {
    state: "PASS",
    evidenceSha256: h("a")
  });
  assert.equal(report.softState, "PASS");
  assert.equal(report.hardState, "BLOCKED");
  assert.equal(report.findings.find((entry) => entry.id === "graph-existing-invariants")!.state, "SATISFIED");
  assert.equal(report.findings.find((entry) => entry.id === "responsive-dom-stability")!.state, "SATISFIED");
  assert.equal(report.findings.find((entry) => entry.id === "release-rights-boundary")!.state, "NOT_EVALUATED");
  await validateAgainstSchema(report, "page-graph-constraint-report.schema.json");
});

test("semantic drift becomes a hard failure and is detectable relative to the previous report", () => {
  const source = graph();
  const before = evaluatePageGraphConstraints(source);
  const drifted = structuredClone(source);
  [drifted.semanticOrder[1], drifted.semanticOrder[2]] = [drifted.semanticOrder[2]!, drifted.semanticOrder[1]!];
  const after = evaluatePageGraphConstraints(drifted);
  assert.equal(after.hardState, "FAIL");
  const introduced = introducedHardConstraintFailures(before, after);
  assert.ok(introduced.includes("graph-existing-invariants"));
  assert.ok(introduced.includes("semantic-order-and-chrome"));
});

test("soft design quality failure remains soft and cannot hide a separate hard blocked rights lane", () => {
  const report = evaluatePageGraphConstraints(graph(), {
    state: "FAIL",
    evidenceSha256: h("b"),
    diagnostics: ["measured composition score is below the governed threshold"]
  });
  assert.equal(report.softState, "FAIL");
  assert.equal(report.hardState, "BLOCKED");
  assert.equal(report.findings.find((entry) => entry.id === "design-quality-objective")!.state, "UNSATISFIED");
});

test("deterministic text overflow is NEEDS_INPUT evidence, not justification for a generic solver", async () => {
  const textFit = createDeterministicTextFitCase(
    "hero-copy-overflow",
    "This supplied headline is intentionally longer than the governed mobile text budget.",
    20,
    h("c")
  );
  assert.equal(textFit.deterministicOutcome, "NEEDS_INPUT");
  assert.equal(textFit.deterministicPassCanSelect, true);
  const decision = decideSolverAdmission([textFit]);
  assert.equal(decision.state, "NOT_REQUIRED_FOR_CURRENT_CASESET");
  assert.equal(decision.solverAdapterState, "NOT_ADMITTED");
  assert.deepEqual(decision.triggeredCaseIds, []);
  await validateAgainstSchema(decision, "solver-admission-decision.schema.json");
});

test("a measured ambiguous multi-variable search case requires admission but still cannot execute a solver", () => {
  const ambiguous: SolverBenchmarkCase = {
    caseId: "two-column-layout-search",
    decisionVariableCount: 3,
    feasibleCandidateCount: 4,
    hardConstraintsSatisfied: true,
    softObjectiveCount: 2,
    deterministicPassCanSelect: false,
    deterministicOutcome: "AMBIGUOUS",
    evidenceSha256: h("d")
  };
  const decision = decideSolverAdmission([ambiguous]);
  assert.equal(decision.state, "REQUIRED_NOT_ADMITTED");
  assert.equal(decision.solverAdapterState, "NOT_ADMITTED");
  assert.deepEqual(decision.triggeredCaseIds, ["two-column-layout-search"]);
});

test("solver benchmark identity is deterministic under case ordering and rejects floating malformed evidence", () => {
  const a: SolverBenchmarkCase = {
    caseId: "case-a",
    decisionVariableCount: 1,
    feasibleCandidateCount: 1,
    hardConstraintsSatisfied: true,
    softObjectiveCount: 0,
    deterministicPassCanSelect: true,
    deterministicOutcome: "PASS",
    evidenceSha256: h("e")
  };
  const b: SolverBenchmarkCase = { ...a, caseId: "case-b", evidenceSha256: h("f") };
  assert.equal(decideSolverAdmission([a, b]).caseSetSha256, decideSolverAdmission([b, a]).caseSetSha256);
  assert.throws(() => decideSolverAdmission([{ ...a, evidenceSha256: "bad" }]), /exact SHA-256/);
  assert.throws(() => decideSolverAdmission([{ ...a, decisionVariableCount: -1 }]), /non-negative integer/);
});
