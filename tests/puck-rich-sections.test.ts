import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_CONTRACTS, SECTION_KINDS } from "../src/section-grammar.js";
import { validateAuthoringData } from "../src/puck-authoring.js";

function fixture(kind:(typeof SECTION_KINDS)[number]){
  const contract=SECTION_CONTRACTS[kind];const fields:Record<string,unknown>={};const provenance:Record<string,string>={};
  for(const [name,field] of Object.entries(contract.fields))if(field.required){fields[name]=field.type==="items"?["fixture"]:field.type==="link"?{label:"Action",href:"#"}:field.type==="media"?{assetId:"fixture",alt:"Fixture"}:field.type==="number"?1:`${kind} ${name}`;provenance[name]=`fixture:${kind}:${name}`;}
  return{type:"RichSectionBlock" as const,props:{id:`section-${kind}`,kind,variant:contract.variants[0],fields,provenance,tokenRef:"semantic-design-tokens/v2"}};
}

test("Puck authoring validator accepts all canonical rich section blocks",()=>{
  const data={content:SECTION_KINDS.map(fixture),root:{props:{pageTitle:"Rich registry",surfaceToken:"surface-default"}}};
  assert.deepEqual(validateAuthoringData(data),{overall:"PASS",errors:[]});
});

test("rich authoring block cannot bypass canonical section field or provenance rules",()=>{
  const block=fixture("metrics");
  const invalid={content:[{...block,props:{...block.props,fields:{items:["99%"]},provenance:{},html:"<b>bad</b>"}}],root:{}};
  const result=validateAuthoringData(invalid);
  assert.equal(result.overall,"FAIL");
  assert.ok(result.errors.some((error)=>error.includes("not an approved prop")));
  assert.ok(result.errors.some((error)=>error.includes("missing provenance for items")));
});
