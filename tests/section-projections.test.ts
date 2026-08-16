import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_KINDS } from "../src/section-grammar.js";
import { projectSectionContracts, projectionDriftErrors } from "../src/section-projections.js";

test("Puck Payload and Storybook projection identities cover every canonical section",()=>{
  const projection=projectSectionContracts();
  assert.equal(projection.length,SECTION_KINDS.length);
  assert.deepEqual(projection.map((entry)=>entry.kind),[...SECTION_KINDS]);
  assert.equal(new Set(projection.map((entry)=>entry.authoringType)).size,SECTION_KINDS.length);
  assert.equal(new Set(projection.map((entry)=>entry.payloadSlug)).size,SECTION_KINDS.length);
  assert.equal(new Set(projection.map((entry)=>entry.storyId)).size,SECTION_KINDS.length);
  assert.deepEqual(projectionDriftErrors(projection),[]);
});

test("projection drift fails when canonical fields or variants are dropped",()=>{
  const projection=projectSectionContracts();
  const mutated=projection.map((entry,index)=>index===0?{...entry,fields:entry.fields.slice(1)}:entry);
  assert.ok(projectionDriftErrors(mutated).some((error)=>error.includes("field drift")));
});
