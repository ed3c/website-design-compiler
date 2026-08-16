import assert from "node:assert/strict";
import test from "node:test";
import { buildGraphics2DPlan } from "../src/graphics-2d.js";

test("graphics 2d plan is progressive enhancement with semantic and static fallback", () => {
  const plan = buildGraphics2DPlan();
  assert.equal(plan.rendererPolicy.progressiveEnhancement, true);
  assert.deepEqual(plan.rendererPolicy.capabilityOrder, ["webgpu", "webgl", "canvas2d"]);
  assert.equal(plan.scene.criticalContent, false);
  assert.equal(plan.fallback.semanticDom, "REQUIRED");
  assert.equal(plan.fallback.staticPoster, "REQUIRED");
  assert.equal(plan.fallback.forcedTestHook, "graphics=off");
});

test("graphics 2d plan caps DPR and records deterministic zero-external-asset budget", () => {
  const plan = buildGraphics2DPlan();
  assert.equal(plan.dprPolicy.desktopMax, 2);
  assert.equal(plan.dprPolicy.coarsePointerMax, 1.5);
  assert.equal(plan.assetBudget.externalBytes, 0);
  assert.equal(plan.assetBudget.textureBytes, 0);
  assert.ok(plan.assetBudget.externalBytes <= plan.assetBudget.maxExternalBytes);
});

test("graphics 2d lifecycle owns lazy load and teardown", () => {
  const lifecycle = buildGraphics2DPlan().lifecycle;
  assert.deepEqual(lifecycle, {
    lazyImport: true,
    privateTicker: true,
    removeListeners: true,
    destroyApplication: true
  });
});
