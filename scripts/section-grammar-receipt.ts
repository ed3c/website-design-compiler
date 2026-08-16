import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SECTION_CONTRACTS, SECTION_KINDS, sectionRegistryProjection } from "../src/section-grammar.js";

const outputDirectory = resolve("artifacts/v2/section-grammar");
await mkdir(outputDirectory, { recursive: true });
const projection = sectionRegistryProjection();
const evidenceRequired = SECTION_KINDS.filter((kind) => SECTION_CONTRACTS[kind].claimPolicy === "EVIDENCE_REQUIRED");
const overall = SECTION_KINDS.length >= 15 && projection.length === SECTION_KINDS.length && projection.every((entry) => entry.rawMarkupAllowed === false && entry.tokenOwnership === "semantic-design-tokens/v2") ? "PASS" : "FAIL";
const receipt = { schema:"website-design-compiler/section-grammar-receipt/v2", overall, contractCount:SECTION_KINDS.length, evidenceRequired, projection };
await writeFile(resolve(outputDirectory,"registry.json"), `${JSON.stringify(projection,null,2)}\n`, "utf8");
await writeFile(resolve(outputDirectory,"receipt.json"), `${JSON.stringify(receipt,null,2)}\n`, "utf8");
console.log(JSON.stringify({overall,contractCount:SECTION_KINDS.length,evidenceRequiredCount:evidenceRequired.length}));
if(overall!=="PASS") process.exitCode=1;
