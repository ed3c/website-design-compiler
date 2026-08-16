import assert from "node:assert/strict";
import test from "node:test";
import { buildMotionDirectorPlan } from "../src/motion-director.js";
import type { CompilerInput } from "../src/contracts.js";

const input: CompilerInput = {
  schema: "website-design-compiler/input/v1",
  project: "motion-fixture",
  brief: { pageType: "landing", audience: "teams", objective: "bounded motion" },
  requestedStages: ["motion-director"]
};

test("every motion effect has purpose and cannot block primary interaction", () => {
  const plan = buildMotionDirectorPlan(input);
  assert.equal(plan.policy, "PURPOSE_REQUIRED");
  assert.ok(plan.effects.length >= 2);
  for (const effect of plan.effects) {
    assert.ok(effect.purpose.length > 0);
    assert.equal(effect.blocksPrimaryInteraction, false);
    assert.ok(effect.durationMs <= 2000);
  }
});

test("motion plan contains explicit reduced-motion and coarse-pointer policies", () => {
  const plan = buildMotionDirectorPlan(input);
  const motionEffect = plan.effects.find((effect) => effect.engine === "motion");
  const gsapEffect = plan.effects.find((effect) => effect.engine === "gsap");
  assert.equal(motionEffect?.reducedMotionPolicy, "instant");
  assert.equal(gsapEffect?.reducedMotionPolicy, "disable");
  assert.equal(gsapEffect?.mobilePolicy, "disable-on-coarse-pointer");
});
