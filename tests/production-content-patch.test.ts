import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { NaturalLanguageBriefInput } from "../src/brief-normalizer.js";
import { validateCompletePageGraph } from "../src/complete-page-graph.js";
import {
  applyProductionContentPatch,
  createProductionContentPatch,
  productionContentFieldDigest,
  revertProductionContentPatch
} from "../src/compiler-kernel/production-content-patch.js";
import { assertLosslessPageGraphRoundTrip, pageGraphFingerprint, pageGraphToPuck } from "../src/page-graph-roundtrip.js";
import { compileProductionSite } from "../src/production-site-compiler.js";
import { validateAuthoringData } from "../src/puck-authoring.js";
import { validateAgainstSchema } from "../src/validate.js";

const qualityInputs = JSON.parse(
  await readFile(new URL("../fixtures/v2/quality-site-benchmarks.json", import.meta.url), "utf8")
) as NaturalLanguageBriefInput[];
const observation = "a".repeat(64);

function productionPage() {
  const compilation = compileProductionSite(qualityInputs[0]!);
  const page = compilation.siteGraph.routes[0]!.page;
  assert.equal(page.source.mode, "PRODUCTION");
  assert.equal(page.readiness, "READY");
  return page;
}

function heroHeadlinePatch() {
  const graph = productionPage();
  const hero = graph.nodes.find((node) => node.kind === "hero")!;
  const field = hero.contentContract!.fields.find((entry) => entry.slot === "headline")!;
  const patch = createProductionContentPatch({
    patchId: "production-hero-headline",
    expectedBaseDigest: pageGraphFingerprint(graph),
    actor: { kind: "HUMAN", id: "authoring-user" },
    evidenceSha256: [observation],
    operations: [{
      operationId: "set-production-headline",
      op: "SET_CONTENT_SLOT",
      nodeId: hero.id,
      expectedNodeKind: hero.kind,
      field: "headline",
      slot: "headline",
      expectedContentFieldSha256: productionContentFieldDigest(field),
      value: "Evidence-bound production headline",
      sourceType: "user_supplied_claim",
      sourceObservationSha256: observation
    }]
  });
  return { graph, heroId: hero.id, patch };
}

test("production content edit atomically updates section and embedded content contract", async () => {
  const { graph, heroId, patch } = heroHeadlinePatch();
  const result = applyProductionContentPatch(graph, patch);
  assert.equal(result.receipt.state, "APPLIED");
  assert.ok(result.graph);
  assert.equal(result.graph!.readiness, "READY");
  assert.deepEqual(validateCompletePageGraph(result.graph!), []);
  const hero = result.graph!.nodes.find((node) => node.id === heroId)!;
  const field = hero.contentContract!.fields.find((entry) => entry.slot === "headline")!;
  assert.equal(field.value, "Evidence-bound production headline");
  assert.equal(field.state, "READY");
  assert.equal(field.publishable, true);
  assert.equal(field.sourceType, "user_supplied_claim");
  assert.deepEqual(field.provenance, [`source-observation:sha256:${observation}`]);
  assert.equal(hero.section.props.headline, "Evidence-bound production headline");
  assert.equal(hero.section.provenance.headline, `source-observation:sha256:${observation}`);
  assertLosslessPageGraphRoundTrip(result.graph!);
  await validateAgainstSchema(patch, "production-content-patch.schema.json");
  await validateAgainstSchema(result.receipt, "production-content-patch-receipt.schema.json");
});

test("stale field identity and section-slot mismatch fail closed", () => {
  const { graph, patch } = heroHeadlinePatch();
  const stale = createProductionContentPatch({
    ...patch,
    operations: [{ ...patch.operations[0]!, expectedContentFieldSha256: "b".repeat(64) }]
  });
  const conflict = applyProductionContentPatch(graph, stale);
  assert.equal(conflict.receipt.state, "CONFLICT");
  assert.equal(conflict.graph, null);
  assert.match(conflict.receipt.diagnostics.join("; "), /content-field precondition/);

  const hero = graph.nodes.find((node) => node.kind === "hero")!;
  const actionField = hero.contentContract!.fields.find((entry) => entry.slot === "primary-action")!;
  const mismatch = createProductionContentPatch({
    patchId: "mismatched-slot",
    expectedBaseDigest: pageGraphFingerprint(graph),
    actor: { kind: "AGENT", id: "content-editor" },
    evidenceSha256: [observation],
    operations: [{
      operationId: "mismatched-headline-slot",
      op: "SET_CONTENT_SLOT",
      nodeId: hero.id,
      expectedNodeKind: hero.kind,
      field: "headline",
      slot: "primary-action",
      expectedContentFieldSha256: productionContentFieldDigest(actionField),
      value: "Wrong projection target",
      sourceType: "user_supplied_claim",
      sourceObservationSha256: observation
    }]
  });
  const rejected = applyProductionContentPatch(graph, mismatch);
  assert.equal(rejected.receipt.state, "REJECTED");
  assert.match(rejected.receipt.diagnostics.join("; "), /field\/content slot mismatch/);
});

test("source observation must be admitted by the patch and list slots reject scalar values", () => {
  const { graph, patch } = heroHeadlinePatch();
  assert.throws(
    () => createProductionContentPatch({ ...patch, evidenceSha256: ["c".repeat(64)] }),
    /source observation is not present in the patch evidence set/
  );

  const feature = graph.nodes.find((node) => node.kind === "feature-grid")!;
  const field = feature.contentContract!.fields.find((entry) => entry.slot === "feature-items")!;
  const scalar = createProductionContentPatch({
    patchId: "feature-items-scalar",
    expectedBaseDigest: pageGraphFingerprint(graph),
    actor: { kind: "HUMAN", id: "authoring-user" },
    evidenceSha256: [observation],
    operations: [{
      operationId: "set-feature-items-scalar",
      op: "SET_CONTENT_SLOT",
      nodeId: feature.id,
      expectedNodeKind: feature.kind,
      field: "items",
      slot: "feature-items",
      expectedContentFieldSha256: productionContentFieldDigest(field),
      value: "This must remain a list",
      sourceType: "user_supplied_claim",
      sourceObservationSha256: observation
    }]
  });
  const rejected = applyProductionContentPatch(graph, scalar);
  assert.equal(rejected.receipt.state, "REJECTED");
  assert.match(rejected.receipt.diagnostics.join("; "), /scalar\/list or length contract/);
});

test("claim-sensitive proof content requires observed-fact evidence", () => {
  const graph = productionPage();
  const proof = graph.nodes.find((node) => node.kind === "proof-cloud")!;
  const field = proof.contentContract!.fields.find((entry) => entry.slot === "proof-items")!;
  const claim = createProductionContentPatch({
    patchId: "proof-user-claim",
    expectedBaseDigest: pageGraphFingerprint(graph),
    actor: { kind: "HUMAN", id: "authoring-user" },
    evidenceSha256: [observation],
    operations: [{
      operationId: "set-proof-user-claim",
      op: "SET_CONTENT_SLOT",
      nodeId: proof.id,
      expectedNodeKind: proof.kind,
      field: "items",
      slot: "proof-items",
      expectedContentFieldSha256: productionContentFieldDigest(field),
      value: ["A user claim cannot silently become verified proof"],
      sourceType: "user_supplied_claim",
      sourceObservationSha256: observation
    }]
  });
  const rejected = applyProductionContentPatch(graph, claim);
  assert.equal(rejected.receipt.state, "REJECTED");
  assert.match(rejected.receipt.diagnostics.join("; "), /claim-sensitive section requires observed_fact evidence/);
});

test("revert restores exact prior graph without placing prior content bytes in the receipt", async () => {
  const { graph, patch } = heroHeadlinePatch();
  const applied = applyProductionContentPatch(graph, patch);
  assert.equal(applied.receipt.state, "APPLIED");
  const reverted = revertProductionContentPatch(
    applied.graph!,
    graph,
    applied.receipt,
    "revert-production-headline",
    { kind: "HUMAN", id: "reviewer" }
  );
  assert.equal(reverted.receipt.state, "APPLIED");
  assert.equal(pageGraphFingerprint(reverted.graph!), pageGraphFingerprint(graph));
  assert.equal(reverted.receipt.history.parentReceiptSha256, applied.receipt.receiptIdentitySha256);
  assert.equal(reverted.receipt.history.revertsReceiptSha256, applied.receipt.receiptIdentitySha256);
  assert.equal(JSON.stringify(reverted.receipt).includes("Evidence-bound production headline"), false);
  await validateAgainstSchema(reverted.receipt, "production-content-patch-receipt.schema.json");
});

test("direct Puck mutation cannot bypass content-contract and signature validation", () => {
  const { graph, patch } = heroHeadlinePatch();
  const applied = applyProductionContentPatch(graph, patch);
  assert.equal(applied.receipt.state, "APPLIED");
  const puck = pageGraphToPuck(applied.graph!);
  const hero = puck.content.find((entry) => entry.props.kind === "hero")!;
  hero.props.section.props.headline = "Direct authoring mutation";
  const validation = validateAuthoringData(puck);
  assert.equal(validation.overall, "FAIL");
  assert.ok(validation.errors.some((entry) => entry.includes("content") || entry.includes("signature")));
});
