import assert from "node:assert/strict";
import test from "node:test";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import {
  applyCompilerKernelPatch,
  createDeterministicTextFitCase,
  createInversePageGraphPatch,
  createPageGraphPatch,
  decideSolverAdmission,
  pageGraphPatchValueDigest,
  type PatchJsonValue,
  type SolverBenchmarkCase
} from "../src/compiler-kernel/index.js";
import { assertLosslessPageGraphRoundTrip, pageGraphFingerprint } from "../src/page-graph-roundtrip.js";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { validateAgainstSchema } from "../src/validate.js";

const h = (value: string) => value.repeat(64).slice(0, 64);

function baseGraph() {
  return compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
}

function headlinePatch() {
  const graph = baseGraph();
  const hero = graph.nodes.find((node) => node.kind === "hero")!;
  const current = hero.section.props.headline as PatchJsonValue;
  const patch = createPageGraphPatch({
    patchId: "kernel-headline-edit",
    expectedBaseDigest: pageGraphFingerprint(graph),
    actor: { kind: "AGENT", id: "compiler-kernel-convergence-agent" },
    evidenceSha256: [h("a")],
    operations: [{
      operationId: "set-headline",
      op: "SET_SECTION_FIELD",
      nodeId: hero.id,
      expectedNodeKind: hero.kind,
      field: "headline",
      expectedValueSha256: pageGraphPatchValueDigest(current),
      value: "Governed bidirectional edit",
      fieldProvenance: `source-observation:sha256:${h("a")}`
    }]
  });
  return { graph, patch };
}

test("converged kernel accepts a valid patch only when it introduces no new hard constraint failure", async () => {
  const { graph, patch } = headlinePatch();
  const result = applyCompilerKernelPatch(graph, patch, undefined, {
    state: "PASS",
    evidenceSha256: h("b")
  });
  assert.equal(result.receipt.state, "APPLIED");
  assert.ok(result.graph);
  assert.deepEqual(result.receipt.introducedHardFailures, []);
  assert.equal(result.receipt.resultDigest, pageGraphFingerprint(result.graph!));
  assertLosslessPageGraphRoundTrip(result.graph!);
  assert.equal(result.afterConstraints!.softState, "PASS");
  assert.notEqual(result.afterConstraints!.hardState, "PASS", "external rights remain an explicit hard lane in this foundation wave");
  await validateAgainstSchema(result.receipt, "compiler-kernel-patch-receipt.schema.json");
});

test("inverse edit restores the exact base graph while preserving append-only revert linkage", () => {
  const { graph, patch } = headlinePatch();
  const applied = applyCompilerKernelPatch(graph, patch);
  assert.equal(applied.receipt.state, "APPLIED");
  const inverse = createInversePageGraphPatch(
    applied.patchApplication.receipt,
    "kernel-headline-undo",
    { kind: "HUMAN", id: "authoring-reviewer" },
    [h("c")]
  );
  const reverted = applyCompilerKernelPatch(applied.graph!, inverse, {
    parentReceiptSha256: applied.patchApplication.receipt.receiptIdentitySha256,
    revertsReceiptSha256: applied.patchApplication.receipt.receiptIdentitySha256
  });
  assert.equal(reverted.receipt.state, "APPLIED");
  assert.equal(pageGraphFingerprint(reverted.graph!), pageGraphFingerprint(graph));
  assert.equal(
    reverted.patchApplication.receipt.history.revertsReceiptSha256,
    applied.patchApplication.receipt.receiptIdentitySha256
  );
});

test("kernel rejects a structurally valid candidate when it newly violates semantic chrome order", async () => {
  const graph = baseGraph();
  const navigation = graph.nodes[0]!;
  assert.equal(navigation.kind, "navigation");
  const patch = createPageGraphPatch({
    patchId: "move-navigation-out-of-root",
    expectedBaseDigest: pageGraphFingerprint(graph),
    actor: { kind: "AGENT", id: "compiler-kernel-convergence-agent" },
    evidenceSha256: [h("d")],
    operations: [{
      operationId: "move-navigation",
      op: "MOVE_NODE",
      nodeId: navigation.id,
      expectedNodeKind: navigation.kind,
      expectedFromIndex: 0,
      toIndex: 1
    }]
  });
  const result = applyCompilerKernelPatch(graph, patch);
  assert.equal(result.patchApplication.receipt.state, "APPLIED", "raw patch runtime can materialize a candidate graph");
  assert.equal(result.receipt.state, "HARD_CONSTRAINT_REJECTED");
  assert.equal(result.graph, null);
  assert.ok(result.receipt.introducedHardFailures.includes("semantic-order-and-chrome"));
  await validateAgainstSchema(result.receipt, "compiler-kernel-patch-receipt.schema.json");
});

test("stale base remains an explicit conflict before constraint promotion", () => {
  const { graph, patch } = headlinePatch();
  const stale = createPageGraphPatch({ ...patch, expectedBaseDigest: h("e") });
  const result = applyCompilerKernelPatch(graph, stale);
  assert.equal(result.receipt.state, "CONFLICT");
  assert.equal(result.graph, null);
  assert.equal(result.afterConstraints, null);
});

test("measured solver decision stays fail-closed: text overflow is deterministic, ambiguous search is required but not admitted", () => {
  const overflow = createDeterministicTextFitCase(
    "mobile-headline-overflow",
    "A headline intentionally longer than the bounded mobile copy budget",
    12,
    h("f")
  );
  assert.equal(decideSolverAdmission([overflow]).state, "NOT_REQUIRED_FOR_CURRENT_CASESET");

  const ambiguous: SolverBenchmarkCase = {
    caseId: "multi-variable-layout-search",
    decisionVariableCount: 4,
    feasibleCandidateCount: 3,
    hardConstraintsSatisfied: true,
    softObjectiveCount: 2,
    deterministicPassCanSelect: false,
    deterministicOutcome: "AMBIGUOUS",
    evidenceSha256: h("1")
  };
  const decision = decideSolverAdmission([ambiguous]);
  assert.equal(decision.state, "REQUIRED_NOT_ADMITTED");
  assert.equal(decision.solverAdapterState, "NOT_ADMITTED");
  assert.deepEqual(decision.triggeredCaseIds, ["multi-variable-layout-search"]);
});
