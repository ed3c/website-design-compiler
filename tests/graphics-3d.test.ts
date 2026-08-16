import assert from "node:assert/strict";
import test from "node:test";
import { buildGraphics3DPlan, buildProceduralFixtureProvenance } from "../src/graphics-3d.js";
import { buildLicenseReceipt, loadLicensePolicy } from "../src/license-provenance.js";

test("graphics 3d plan keeps critical content outside WebGL", () => {
  const plan = buildGraphics3DPlan();
  assert.equal(plan.scene.criticalContent, false);
  assert.equal(plan.interaction.pointerRequired, false);
  assert.equal(plan.interaction.primaryActionDependency, false);
  assert.equal(plan.fallback.semanticDom, "REQUIRED");
  assert.equal(plan.fallback.staticPoster, "REQUIRED");
  assert.equal(plan.fallback.failedWebglHook, "graphics3d=off");
});

test("graphics 3d plan caps render work and owns disposal", () => {
  const plan = buildGraphics3DPlan();
  assert.equal(plan.scene.frameloop, "demand");
  assert.equal(plan.lifecycle.lazyChunk, true);
  assert.equal(plan.lifecycle.frameloopDemand, true);
  assert.equal(plan.lifecycle.disposeGeneratedGeometry, true);
  assert.equal(plan.lifecycle.disposeGeneratedMaterial, true);
  assert.equal(plan.dprPolicy.desktopMax, 1.75);
  assert.equal(plan.dprPolicy.coarsePointerMax, 1.25);
  assert.equal(plan.assetBudget.externalBytes, 0);
  assert.equal(plan.assetBudget.textureBytes, 0);
  assert.ok(plan.assetBudget.maxTriangles <= 10_000);
  assert.ok(plan.assetBudget.maxDrawCalls <= 20);
});

test("img2threejs adapter is exact-commit pinned with semantic factory boundary", () => {
  const adapter = buildGraphics3DPlan().proceduralAdapter;
  assert.equal(adapter.name, "img2threejs");
  assert.equal(adapter.sourceRepository, "img2threejs/img2threejs");
  assert.match(adapter.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(adapter.sourceLicense, "Apache-2.0");
  assert.equal(adapter.factoryContract, "THREE.Group");
  assert.deepEqual(adapter.semantics, ["pivots", "sockets", "colliders"]);
  assert.equal(adapter.provenanceRequired, true);
});

test("procedural fixture enters provenance with exact source byte hash", async () => {
  const subject = await buildProceduralFixtureProvenance();
  const receipt = buildLicenseReceipt([subject], await loadLicensePolicy());
  assert.equal(receipt.overall, "PASS");
  assert.equal(subject.kind, "generated-output");
  assert.match(subject.hashSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(subject.versionOrCommit, `sha256:${subject.hashSha256}`);
  assert.match(subject.outputTerms ?? "", /does not assert img2threejs output licensing/);
});

test("WebGPU TSL path is explicit but not falsely exercised", () => {
  assert.equal(buildGraphics3DPlan().experimental.webgpuTsl, "NOT_EXERCISED");
});
