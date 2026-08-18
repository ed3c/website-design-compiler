import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_CONTRACTS, SECTION_KINDS } from "../src/section-grammar.js";
import { projectSectionContracts, projectionDriftErrors } from "../src/section-projections.js";

test("Puck Payload and Storybook projection identities cover every canonical section",()=>{
  const projection=projectSectionContracts();
  assert.equal(projection.length,SECTION_KINDS.length);
  assert.deepEqual(projection.map((entry)=>entry.kind),[...SECTION_KINDS]);
  assert.deepEqual([...new Set(projection.map((entry)=>entry.authoringType))],["RichSectionBlock"]);
  assert.equal(new Set(projection.map((entry)=>entry.payloadSlug)).size,SECTION_KINDS.length);
  assert.equal(new Set(projection.map((entry)=>entry.storyId)).size,SECTION_KINDS.length);
  assert.deepEqual(projectionDriftErrors(projection),[]);
});

test("projection drift compares every canonical field attribute",()=>{
  const projection=projectSectionContracts();
  const hero=projection.find((entry)=>entry.kind==="hero")!;
  const headline=hero.fields.find((field)=>field.name==="headline")!;
  const mutations = [
    { ...headline, type: "number" as const },
    { ...headline, required: false },
    { ...headline, provenanceRequired: false },
    { ...headline, maxLength: 999 }
  ];

  for (const mutation of mutations) {
    const drifted=projection.map((entry)=>entry.kind!=="hero"?entry:{
      ...entry,
      fields:entry.fields.map((field)=>field.name==="headline"?mutation:field)
    });
    assert.ok(projectionDriftErrors(drifted).some((error)=>error.includes("field drift for hero")));
  }
});

test("projection drift rejects duplicate kinds and identity or policy drift",()=>{
  const projection=projectSectionContracts();
  const hero=projection.find((entry)=>entry.kind==="hero")!;
  const duplicate=[...projection,{...hero}];
  assert.ok(projectionDriftErrors(duplicate).some((error)=>error.includes("duplicate projection for hero")));

  const drifted=projection.map((entry)=>entry.kind!=="hero"?entry:{
    ...entry,
    authoringType:"Section:hero",
    tokenOwnership:"raw-token",
    rawMarkupAllowed:true,
    composition:{placement:"NESTED",allowedChildren:["hero"]}
  } as unknown as typeof entry);
  const errors=projectionDriftErrors(drifted);
  assert.ok(errors.some((error)=>error.includes("authoring identity drift for hero")));
  assert.ok(errors.some((error)=>error.includes("token ownership drift for hero")));
  assert.ok(errors.some((error)=>error.includes("raw markup policy drift for hero")));
  assert.ok(errors.some((error)=>error.includes("composition drift for hero")));

  assert.deepEqual(projectSectionContracts().map((entry)=>entry.fields),SECTION_KINDS.map((kind)=>
    Object.entries(SECTION_CONTRACTS[kind].fields).map(([name,field])=>({
      name,
      type:field.type==="rich-text"?"textarea":field.type,
      required:field.required,
      provenanceRequired:field.provenanceRequired,
      ...(field.maxLength===undefined?{}:{maxLength:field.maxLength})
    }))
  ));
});
