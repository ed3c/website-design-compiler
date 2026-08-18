import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_CONTRACTS, SECTION_KINDS } from "../src/section-grammar.js";
import { projectSectionContracts } from "../src/section-projections.js";
import { authoringToPayloadLayout, buildRichSectionPayloadBlocks, payloadLayoutToAuthoring } from "../src/payload-cms.js";
import type { AuthoringData } from "../src/puck-authoring.js";

function richData():AuthoringData{
  return{content:SECTION_KINDS.map((kind)=>{const contract=SECTION_CONTRACTS[kind];const fields:Record<string,unknown>={};const provenance:Record<string,string>={};for(const [name,field] of Object.entries(contract.fields))if(field.required){fields[name]=field.type==="items"?["fixture"]:field.type==="link"?{label:"Action",href:"#"}:field.type==="media"?{assetId:"fixture",alt:"Fixture"}:field.type==="number"?1:`${kind} ${name}`;provenance[name]=`fixture:${kind}:${name}`;}return{type:"RichSectionBlock" as const,props:{id:`section-${kind}`,kind,variant:contract.variants[0],fields,provenance,tokenRef:"semantic-design-tokens/v2"}};}),root:{props:{pageTitle:"Payload rich sections",surfaceToken:"surface-default"}}};
}

test("Payload generates one block schema for every canonical rich section",()=>{
  const blocks=buildRichSectionPayloadBlocks();
  const projections=projectSectionContracts();
  assert.equal(blocks.length,SECTION_KINDS.length);
  assert.deepEqual(blocks.map((block)=>block.slug),SECTION_KINDS.map((kind)=>`section-${kind}`));
  for(const [index,block] of blocks.entries()){
    const projection=projections[index]!;
    const fieldNames=block.fields.flatMap((field)=>"name" in field&&field.name?[field.name]:[]);
    assert.deepEqual(fieldNames,["componentId","variant",...projection.fields.map((field)=>field.name),"provenance","tokenRef"]);
    const variant=block.fields.find((field)=>"name" in field&&field.name==="variant");
    assert.ok(variant&&"options" in variant);
    assert.deepEqual(variant.options,projection.variants);
  }
});

test("all rich section authoring data round-trips through Payload blocks without drift",()=>{
  const source=richData();const layout=authoringToPayloadLayout(source);const roundtrip=payloadLayoutToAuthoring(layout,"Payload rich sections","surface-default");
  assert.deepEqual(roundtrip,source);
});

test("unknown rich Payload section block fails closed",()=>{
  assert.throws(()=>payloadLayoutToAuthoring([{blockType:"section-clone",componentId:"bad",variant:"copy"}],"Bad","surface-default"),/not governed/);
});

test("known rich Payload blocks reject unknown fields and missing token identity",()=>{
  const layout=authoringToPayloadLayout(richData());
  const unknown=structuredClone(layout);
  unknown[0]!.html="<script>alert(1)</script>";
  assert.throws(()=>payloadLayoutToAuthoring(unknown,"Bad","surface-default"),/html is not an approved Payload field/);

  const missingToken=structuredClone(layout);
  delete missingToken[0]!.tokenRef;
  assert.throws(()=>payloadLayoutToAuthoring(missingToken,"Bad","surface-default"),/tokenRef must reference semantic-design-tokens\/v2/);
});
