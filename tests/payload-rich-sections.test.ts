import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_CONTRACTS, SECTION_KINDS } from "../src/section-grammar.js";
import { authoringToPayloadLayout, buildRichSectionPayloadBlocks, payloadLayoutToAuthoring } from "../src/payload-cms.js";
import type { AuthoringData } from "../src/puck-authoring.js";

function richData():AuthoringData{
  return{content:SECTION_KINDS.map((kind)=>{const contract=SECTION_CONTRACTS[kind];const fields:Record<string,unknown>={};const provenance:Record<string,string>={};for(const [name,field] of Object.entries(contract.fields))if(field.required){fields[name]=field.type==="items"?["fixture"]:field.type==="link"?{label:"Action",href:"#"}:field.type==="media"?{assetId:"fixture",alt:"Fixture"}:field.type==="number"?1:`${kind} ${name}`;provenance[name]=`fixture:${kind}:${name}`;}return{type:"RichSectionBlock" as const,props:{id:`section-${kind}`,kind,variant:contract.variants[0],fields,provenance,tokenRef:"semantic-design-tokens/v2"}};}),root:{props:{pageTitle:"Payload rich sections",surfaceToken:"surface-default"}}};
}

test("Payload generates one block schema for every canonical rich section",()=>{
  const blocks=buildRichSectionPayloadBlocks();
  assert.equal(blocks.length,SECTION_KINDS.length);
  assert.deepEqual(blocks.map((block)=>block.slug),SECTION_KINDS.map((kind)=>`section-${kind}`));
});

test("all rich section authoring data round-trips through Payload blocks without drift",()=>{
  const source=richData();const layout=authoringToPayloadLayout(source);const roundtrip=payloadLayoutToAuthoring(layout,"Payload rich sections","surface-default");
  assert.deepEqual(roundtrip,source);
});

test("unknown rich Payload section block fails closed",()=>{
  assert.throws(()=>payloadLayoutToAuthoring([{blockType:"section-clone",componentId:"bad",variant:"copy"}],"Bad","surface-default"),/not governed/);
});
