import assert from "node:assert/strict";
import test from "node:test";
import {transitionMotionRuntimeState} from "../apps/site/components/sections/generated-motion-state.js";

test("route cleanup is terminal even when animation completion arrives later",()=>{
  assert.equal(transitionMotionRuntimeState("ACTIVE","ROUTE_CLEANUP"),"CLEANED");
  assert.equal(transitionMotionRuntimeState("CLEANED","COMPLETE"),"CLEANED");
});

test("generated motion transitions expose only governed runtime states",()=>{
  assert.equal(transitionMotionRuntimeState("PENDING","ACTIVATE"),"ACTIVE");
  assert.equal(transitionMotionRuntimeState("ACTIVE","COMPLETE"),"SETTLED");
  assert.equal(transitionMotionRuntimeState("PENDING","SHOW_STATIC"),"VISIBLE_NO_MOTION");
  assert.equal(transitionMotionRuntimeState("VISIBLE_NO_MOTION","ROUTE_CLEANUP"),"CLEANED");
  assert.equal(transitionMotionRuntimeState("CLEANED","ACTIVATE"),"CLEANED");
});
