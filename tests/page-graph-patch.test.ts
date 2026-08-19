import assert from "node:assert/strict";
import test from "node:test";
import { compileCompletePageGraph, validateCompletePageGraph } from "../src/complete-page-graph.js";
import {
  applyPageGraphPatch,
  createInversePageGraphPatch,
  createPageGraphPatch,
  pageGraphPatchValueDigest,
  type PatchJsonValue
} from "../src/compiler-kernel/page-graph-patch.js";
import { assertLosslessPageGraphRoundTrip, pageGraphFingerprint } from "../src/page-graph-roundtrip.js";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { validateAgainstSchema } from "../src/validate.js";

const evidence = "a".repeat(64);

function baseGraph() {
  return compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
}

function headlinePatch() {
  const graph = baseGraph();
  const hero = graph.nodes.find((node) => node.kind === "hero")!;
  const current = hero.section.props.headline as PatchJsonValue;
  return {
    graph,
    patch: createPageGraphPatch({
      patchId: "edit-hero-headline",
      expectedBaseDigest: pageGraphFingerprint(graph),
      actor: { kind: "AGENT", id: "compiler-kernel-test-agent" },
      evidenceSha256: [evidence],
      operations: [{
        operationId: "set-headline",
        op: "SET_SECTION_FIELD" as const,
        nodeId: hero.id,
        expectedNodeKind: hero.kind,
        field: "headline",
        expectedValueSha256: pageGraphPatchValueDigest(current),
        value: "Edited governed headline",
        fieldProvenance: `source-observation:sha256:${evidence}`
      }]
    })
  };
}

test("a deterministic field patch applies, validates and round-trips through Puck and Payload", async () => {
  const { graph, patch } = headlinePatch();
  const result = applyPageGraphPatch(graph, patch);
  assert.equal(result.receipt.state, "APPLIED");
  assert.ok(result.graph);
  assert.deepEqual(validateCompletePageGraph(result.graph!), []);
  assert.equal(result.receipt.baseDigest, pageGraphFingerprint(graph));
  assert.equal(result.receipt.resultDigest, pageGraphFingerprint(result.graph!));
  assert.notEqual(result.receipt.resultDigest, result.receipt.baseDigest);
  assertLosslessPageGraphRoundTrip(result.graph!);
  await validateAgainstSchema(patch, "page-graph-patch.schema.json");
  await validateAgainstSchema(result.receipt, "page-graph-patch-receipt.schema.json");
});

test("inverse patch restores exact graph bytes while appending a revert receipt link", () => {
  const { graph, patch } = headlinePatch();
  const applied = applyPageGraphPatch(graph, patch);
  assert.equal(applied.receipt.state, "APPLIED");
  const inverse = createInversePageGraphPatch(
    applied.receipt,
    "undo-hero-headline",
    { kind: "HUMAN", id: "reviewer" },
    ["b".repeat(64)]
  );
  const reverted = applyPageGraphPatch(applied.graph!, inverse, {
    parentReceiptSha256: applied.receipt.receiptIdentitySha256,
    revertsReceiptSha256: applied.receipt.receiptIdentitySha256
  });
  assert.equal(reverted.receipt.state, "APPLIED");
  assert.equal(pageGraphFingerprint(reverted.graph!), pageGraphFingerprint(graph));
  assert.equal(reverted.receipt.history.parentReceiptSha256, applied.receipt.receiptIdentitySha256);
  assert.equal(reverted.receipt.history.revertsReceiptSha256, applied.receipt.receiptIdentitySha256);
});

test("wrong base and field preconditions produce explicit conflict receipts without a graph", () => {
  const { graph, patch } = headlinePatch();
  const wrongBase = createPageGraphPatch({ ...patch, expectedBaseDigest: "c".repeat(64) });
  const stale = applyPageGraphPatch(graph, wrongBase);
  assert.equal(stale.receipt.state, "CONFLICT");
  assert.equal(stale.graph, null);
  assert.match(stale.receipt.diagnostics.join("; "), /base digest/);

  const original = patch.operations[0]!;
  if (original.op !== "SET_SECTION_FIELD") throw new Error("headline patch must contain a field operation");
  const wrongValue = createPageGraphPatch({
    ...patch,
    operations: [{ ...original, expectedValueSha256: "d".repeat(64) }]
  });
  const conflict = applyPageGraphPatch(graph, wrongValue);
  assert.equal(conflict.receipt.state, "CONFLICT");
  assert.equal(conflict.graph, null);
  assert.match(conflict.receipt.diagnostics.join("; "), /value precondition/);
});

test("forward field edits must bind provenance to a source observation admitted by the patch evidence set", () => {
  const { graph, patch } = headlinePatch();
  const original = patch.operations[0]!;
  if (original.op !== "SET_SECTION_FIELD") throw new Error("headline patch must contain a field operation");

  const mismatched = createPageGraphPatch({
    ...patch,
    patchId: "mismatched-source-evidence",
    operations: [{ ...original, fieldProvenance: `source-observation:sha256:${"f".repeat(64)}` }]
  });
  const mismatch = applyPageGraphPatch(graph, mismatched);
  assert.equal(mismatch.receipt.state, "REJECTED");
  assert.equal(mismatch.graph, null);
  assert.match(mismatch.receipt.diagnostics.join("; "), /not admitted by patch evidence set/);

  const unbound = createPageGraphPatch({
    ...patch,
    patchId: "unbound-source-evidence",
    operations: [{ ...original, fieldProvenance: "model-inference:unbound" }]
  });
  const missing = applyPageGraphPatch(graph, unbound);
  assert.equal(missing.receipt.state, "REJECTED");
  assert.equal(missing.graph, null);
  assert.match(missing.receipt.diagnostics.join("; "), /must bind source-observation/);
});

test("patches cannot introduce unknown fields or invalid governed variants", () => {
  const graph = baseGraph();
  const hero = graph.nodes.find((node) => node.kind === "hero")!;
  const unknownField = createPageGraphPatch({
    patchId: "unknown-field",
    expectedBaseDigest: pageGraphFingerprint(graph),
    actor: { kind: "AGENT", id: "compiler-kernel-test-agent" },
    evidenceSha256: [evidence],
    operations: [{
      operationId: "inject-html",
      op: "SET_SECTION_FIELD",
      nodeId: hero.id,
      expectedNodeKind: hero.kind,
      field: "rawHtml",
      expectedValueSha256: pageGraphPatchValueDigest(null),
      value: "<script>alert(1)</script>",
      fieldProvenance: `source-observation:sha256:${evidence}`
    }]
  });
  const unknown = applyPageGraphPatch(graph, unknownField);
  assert.equal(unknown.receipt.state, "REJECTED");
  assert.equal(unknown.graph, null);
  assert.match(unknown.receipt.diagnostics.join("; "), /unknown section field/);

  const badVariant = createPageGraphPatch({
    patchId: "invalid-variant",
    expectedBaseDigest: pageGraphFingerprint(graph),
    actor: { kind: "AGENT", id: "compiler-kernel-test-agent" },
    evidenceSha256: [evidence],
    operations: [{
      operationId: "set-invalid-variant",
      op: "SET_VARIANT",
      nodeId: hero.id,
      expectedNodeKind: hero.kind,
      expectedVariant: hero.variant,
      variant: "raw-canvas-only"
    }]
  });
  const rejected = applyPageGraphPatch(graph, badVariant);
  assert.equal(rejected.receipt.state, "REJECTED");
  assert.equal(rejected.graph, null);
  assert.match(rejected.receipt.diagnostics.join("; "), /variant/i);
});

test("node moves reproject semantic order and conversion path instead of mutating canvas coordinates", () => {
  const graph = baseGraph();
  const movable = graph.nodes[1]!;
  assert.notEqual(movable.kind, "navigation");
  assert.notEqual(movable.kind, "footer");
  const patch = createPageGraphPatch({
    patchId: "move-governed-node",
    expectedBaseDigest: pageGraphFingerprint(graph),
    actor: { kind: "HUMAN", id: "authoring-user" },
    evidenceSha256: [evidence],
    operations: [{
      operationId: "move-node",
      op: "MOVE_NODE",
      nodeId: movable.id,
      expectedNodeKind: movable.kind,
      expectedFromIndex: 1,
      toIndex: 2
    }]
  });
  const result = applyPageGraphPatch(graph, patch);
  assert.equal(result.receipt.state, "APPLIED");
  assert.equal(result.graph!.nodes[2]!.id, movable.id);
  assert.deepEqual(result.graph!.semanticOrder, result.graph!.nodes.map((node) => node.id));
  assert.deepEqual(validateCompletePageGraph(result.graph!), []);
});

test("patch identity rejects mutation after normalization", () => {
  const { graph, patch } = headlinePatch();
  const tampered = structuredClone(patch);
  tampered.operations[0] = { ...tampered.operations[0]!, operationId: "tampered-id" };
  assert.throws(() => applyPageGraphPatch(graph, tampered), /identity does not match/);
});
