import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SECTION_CONTRACTS, SECTION_KINDS, sectionRegistryProjection } from "../src/section-grammar.js";
import { projectSectionContracts, projectionDriftErrors } from "../src/section-projections.js";

const outputDirectory=resolve("artifacts/v2/section-grammar");
await mkdir(outputDirectory,{recursive:true});
const registry=sectionRegistryProjection();
const projections=projectSectionContracts();
const driftErrors=projectionDriftErrors(projections);
const evidenceRequired=SECTION_KINDS.filter((kind)=>SECTION_CONTRACTS[kind].claimPolicy==="EVIDENCE_REQUIRED");
const overall=SECTION_KINDS.length>=15&&registry.length===SECTION_KINDS.length&&projections.length===SECTION_KINDS.length&&driftErrors.length===0&&registry.every((entry)=>entry.rawMarkupAllowed===false&&entry.tokenOwnership==="semantic-design-tokens/v2")?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/section-grammar-receipt/v2",overall,contractCount:SECTION_KINDS.length,evidenceRequired,driftErrors,projectionCoverage:{puck:projections.map((entry)=>entry.authoringType),payload:projections.map((entry)=>entry.payloadSlug),storybook:projections.map((entry)=>entry.storyId)},registry,projections};
await writeFile(resolve(outputDirectory,"registry.json"),`${JSON.stringify(registry,null,2)}\n`,"utf8");
await writeFile(resolve(outputDirectory,"projections.json"),`${JSON.stringify(projections,null,2)}\n`,"utf8");
await writeFile(resolve(outputDirectory,"receipt.json"),`${JSON.stringify(receipt,null,2)}\n`,"utf8");
console.log(JSON.stringify({overall,contractCount:SECTION_KINDS.length,projectionCount:projections.length,evidenceRequiredCount:evidenceRequired.length,driftErrors}));
if(overall!=="PASS")process.exitCode=1;
