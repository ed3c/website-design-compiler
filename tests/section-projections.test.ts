import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const variantStories=projection.flatMap((entry)=>entry.variantStories);
  assert.equal(variantStories.length,38);
  assert.equal(new Set(variantStories.map((entry)=>entry.exportName)).size,38);
  assert.equal(new Set(variantStories.map((entry)=>entry.storyId)).size,38);
  assert.deepEqual(projectionDriftErrors(projection),[]);
});

test("projection drift fails when canonical fields or variants are dropped",()=>{
  const projection=projectSectionContracts();
  const mutated=projection.map((entry,index)=>index===0?{...entry,fields:entry.fields.slice(1)}:entry);
  assert.ok(projectionDriftErrors(mutated).some((error)=>error.includes("field drift")));
  const variantMutation=projection.map((entry,index)=>index===0?{...entry,variantStories:entry.variantStories.slice(1)}:entry);
  assert.ok(projectionDriftErrors(variantMutation).some((error)=>error.includes("storybook variant drift")));
});

test("every projected variant has a statically discoverable canonical Storybook export",async()=>{
  const source=await readFile(new URL("../apps/site/components/sections/governed-section.stories.tsx",import.meta.url),"utf8");
  for(const projection of projectSectionContracts())for(const story of projection.variantStories){
    assert.ok(source.includes(`export const ${story.exportName}:Story=canonicalStory("${projection.kind}","${story.variant}");`),`${projection.kind}/${story.variant} is not a static canonical Storybook export`);
  }
});
