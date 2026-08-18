import assert from "node:assert/strict";
import test from "node:test";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileMotionChoreography, validateMotionChoreography } from "../src/motion-choreography.js";

test("generated choreography is policy-complete and budget-safe",()=>{
  for(const page of compileAllSectionPageFixtures()){
    const plan=compileMotionChoreography(page);
    assert.deepEqual(validateMotionChoreography(plan),[]);
    assert.equal(plan.effects.length,page.sections.length);
    for(const effect of plan.effects){
      assert.equal(effect.blocksPrimaryInteraction,false);
      assert.equal(effect.layoutProperties,false);
      assert.equal(effect.cleanup,"on-unmount-and-route-change");
      if(effect.trigger==="scroll-progress")assert.equal(effect.reducedMotion,"disabled");
    }
  }
});

test("section semantics produce materially different choreography across page categories",()=>{
  const plans=compileAllSectionPageFixtures().map(compileMotionChoreography);
  const signatures=plans.map((plan)=>plan.effects.map((e)=>`${e.kind}:${e.purpose}:${e.trigger}:${e.engine}`).join("|"));
  assert.ok(new Set(signatures).size>=4);
});

test("interactive graphics routes continuity effects through GSAP with static fallback",()=>{
  const page=compileAllSectionPageFixtures().find((entry)=>entry.category==="interactive-3d")!;
  const plan=compileMotionChoreography(page);
  const effect=plan.effects.find((entry)=>entry.kind==="graphics-3d-stage")!;
  assert.equal(effect.engine,"gsap");
  assert.equal(effect.purpose,"spatial-continuity");
  assert.equal(effect.reducedMotion,"disabled");
  assert.equal(effect.fallback,"static-visible");
});

test("structural chrome and disclosure sections remain static by design",()=>{
  for(const page of compileAllSectionPageFixtures()){
    const plan=compileMotionChoreography(page);
    for(const effect of plan.effects.filter((entry)=>["navigation","footer","faq","proof-cloud"].includes(entry.kind))){
      assert.equal(effect.engine,"none");
      assert.equal(effect.durationMs,0);
      assert.equal(effect.delayMs,0);
    }
    assert.ok(plan.engineRouting.none>=2);
  }
});
