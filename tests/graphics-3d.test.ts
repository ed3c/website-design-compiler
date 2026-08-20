import assert from "node:assert/strict";
import test from "node:test";
import { buildGraphics3DPlan, buildProceduralFixtureProvenance } from "../src/graphics-3d.js";
import { buildLicenseReceipt, loadLicensePolicy } from "../src/license-provenance.js";
import { validateAgainstSchema } from "../src/validate.js";

test("graphics 3d plan keeps critical content outside WebGL", () => {
  const plan = buildGraphics3DPlan();
  assert.equal(plan.schema, "website-design-compiler/graphics-3d-plan/v2");
  assert.equal(plan.scene.criticalContent, false);
  assert.equal(plan.interaction.pointerRequired, false);
  assert.equal(plan.interaction.primaryActionDependency, false);
  assert.equal(plan.fallback.semanticDom, "REQUIRED");
  assert.equal(plan.fallback.staticPoster, "REQUIRED");
  assert.equal(plan.fallback.failedWebglHook, "graphics3d=off");
  assert.equal(plan.fallback.webgpuOptInHook, "graphics3d=webgpu");
});

test("graphics 3d plan caps render work and owns disposal", () => {
  const plan = buildGraphics3DPlan();
  assert.equal(plan.scene.frameloop, "demand");
  assert.equal(plan.lifecycle.lazyChunk, true);
  assert.equal(plan.lifecycle.lazyWebgpuImport, true);
  assert.equal(plan.lifecycle.frameloopDemand, true);
  assert.equal(plan.lifecycle.continuousFrameLoop, false);
  assert.equal(plan.lifecycle.deviceLossFallback, true);
  assert.equal(plan.lifecycle.disposeGeneratedGeometry, true);
  assert.equal(plan.lifecycle.disposeGeneratedMaterial, true);
  assert.equal(plan.dprPolicy.desktopMax, 1.75);
  assert.equal(plan.dprPolicy.coarsePointerMax, 1.25);
  assert.equal(plan.assetBudget.externalBytes, 0);
  assert.equal(plan.assetBudget.textureBytes, 0);
  assert.equal(plan.assetBudget.maxTextureMemoryBytes, 16_777_216);
  assert.equal(plan.assetBudget.maxFramesPerInvalidation, 1);
  assert.ok(plan.assetBudget.maxTriangles <= 10_000);
  assert.ok(plan.assetBudget.maxDrawCalls <= 20);
});

test("WebGPU adapter is opt-in and publishes exact identity and receipt states", () => {
  const plan = buildGraphics3DPlan();
  assert.equal(plan.rendererPolicy.stableDefault, "webgl");
  assert.deepEqual(plan.rendererPolicy.webgpuOptInFallbackOrder, ["webgpu", "webgl", "static"]);
  assert.deepEqual(plan.rendererPolicy.receiptStates, [
    "WEBGPU_PASS",
    "WEBGL_FALLBACK",
    "STATIC_FALLBACK"
  ]);
  assert.deepEqual(plan.webgpuAdapter, {
    adapter: "navigator.gpu",
    renderer: "three.WebGPURenderer",
    rendererVersion: "0.184.0",
    tslModule: "three/tsl@0.184.0",
    requiredFeatures: [],
    capabilityIdentity: ["adapter-info", "features", "limits"]
  });
});

test("TSL material remains decorative and defines WebGL and static fallbacks", () => {
  const materials = buildGraphics3DPlan().materials;
  assert.equal(materials.policy, "tsl-node-material");
  assert.equal(materials.webgpu, "MeshStandardNodeMaterial");
  assert.equal(materials.webglFallback, "MeshStandardMaterial");
  assert.equal(materials.staticFallback, "DOM-owned-poster");
  assert.equal(materials.criticalContent, false);
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

test("WebGPU runtime schema accepts the adapter identity emitted by the browser producer", async () => {
  const receipt = {
    schema: "website-design-compiler/webgpu-runtime-receipt/v1",
    overall: "PASS",
    rendererOutcome: "WEBGPU_PASS",
    git: { sha: "a".repeat(40), ref: "refs/heads/test" },
    selected: {
      state: "WEBGPU_PASS",
      renderer: "webgpu",
      reason: "webgpu-runtime-observed",
      capabilities: { webgpu: true, webgl: true },
      runtime: {
        state: "WEBGPU_PASS",
        identity: {
          adapter: "navigator.gpu",
          renderer: "three.WebGPURenderer",
          rendererVersion: "0.184.0",
          tslModule: "three/tsl@0.184.0",
          adapterInfo: { state:"REPORTED",sha256:"a".repeat(64) },
          features: [],
          limits: { maxTextureDimension2D: 8192, maxBindGroups: 4, maxBufferSize: 268435456 }
        },
        budget: {
          dpr: 1,
          drawCalls: 1,
          triangles: 12,
          textureBytes: 0,
          framesRendered: 1,
          frameLoop: "demand"
        }
      }
    },
    fallbacks: { initializationFailure: "PASS", totalGpuFailure: "PASS", deviceLoss: "PASS" }
  };

  await validateAgainstSchema(receipt, "webgpu-runtime-receipt.schema.json");
});
