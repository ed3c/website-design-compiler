import assert from "node:assert/strict";
import test from "node:test";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileMediaOrchestration, validateMediaOrchestration } from "../src/media-orchestration.js";

test("six page categories choose materially different media strategies",()=>{
  const plans=compileAllSectionPageFixtures().map(compileMediaOrchestration);
  assert.equal(plans.length,6);
  assert.equal(new Set(plans.map((plan)=>plan.strategySignature)).size,6);
  assert.ok(plans.some((plan)=>plan.decisions.some((d)=>d.renderer==="video")));
  assert.ok(plans.some((plan)=>plan.decisions.some((d)=>d.renderer==="pixi")));
  assert.ok(plans.some((plan)=>plan.decisions.some((d)=>d.renderer==="three")));
  assert.ok(plans.some((plan)=>plan.decisions.some((d)=>d.renderer==="dom"&&d.kind==="hero")));
});

test("every rich media choice preserves DOM semantic ownership, budget and lower-complexity fallback",()=>{
  for(const page of compileAllSectionPageFixtures()){
    const plan=compileMediaOrchestration(page);
    assert.deepEqual(validateMediaOrchestration(plan),[]);
    for(const decision of plan.decisions){
      assert.equal(decision.accessibility.semanticOwner,"DOM");
      if(decision.renderer!=="dom")assert.notEqual(decision.fallback.providerFailure,decision.renderer);
    }
  }
});

test("generated image and video jobs fail closed until a production provider is admitted",()=>{
  const plans=compileAllSectionPageFixtures().map(compileMediaOrchestration);
  const generated=plans.flatMap((plan)=>plan.decisions).filter((d)=>d.renderer==="image"||d.renderer==="video");
  assert.ok(generated.length>0);
  assert.ok(generated.every((d)=>d.execution.provider==="PRODUCTION_PROVIDER_REQUIRED"&&d.execution.state==="PROVIDER_NOT_ADMITTED"&&d.execution.provenanceRequired));
});
