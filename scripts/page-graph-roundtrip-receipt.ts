import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { assertLosslessPageGraphRoundTrip, pageGraphFingerprint, pageGraphToPuck, puckToPayload } from "../src/page-graph-roundtrip.js";

const outputDirectory=resolve("artifacts/v2/page-graph-roundtrip");
await mkdir(outputDirectory,{recursive:true});
const rows=[];
for(const page of compileAllSectionPageFixtures()){
  const graph=compileCompletePageGraph(page);
  const fingerprint=pageGraphFingerprint(graph);
  const roundTrip=assertLosslessPageGraphRoundTrip(graph);
  const puck=pageGraphToPuck(graph);
  const payload=puckToPayload(puck);
  await writeFile(resolve(outputDirectory,`${graph.category}.puck.json`),`${JSON.stringify(puck,null,2)}\n`,`utf8`);
  await writeFile(resolve(outputDirectory,`${graph.category}.payload.json`),`${JSON.stringify(payload,null,2)}\n`,`utf8`);
  rows.push({category:graph.category,route:graph.route,nodeCount:graph.nodes.length,fingerprint,puckFingerprint:roundTrip.puck,payloadFingerprint:roundTrip.payload,semanticOrder:[...graph.semanticOrder],sharedChrome:graph.sharedChrome});
}
const uniqueFingerprints=new Set(rows.map((row)=>row.fingerprint)).size;
const overall=rows.length===6&&uniqueFingerprints===6&&rows.every((row)=>row.fingerprint===row.puckFingerprint&&row.fingerprint===row.payloadFingerprint)?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/page-graph-roundtrip-receipt/v2",overall,categoryCount:rows.length,uniqueFingerprints,rows};
await writeFile(resolve(outputDirectory,"receipt.json"),`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
console.log(JSON.stringify({overall,categoryCount:rows.length,uniqueFingerprints}));
if(overall!=="PASS")process.exitCode=1;
