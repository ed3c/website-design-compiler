import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph, validateCompletePageGraph } from "../src/complete-page-graph.js";

const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
const errors=graphs.flatMap((graph)=>validateCompletePageGraph(graph).map((error)=>`${graph.category}: ${error}`));
const uniqueSignatures=new Set(graphs.map((graph)=>graph.signature)).size;
if(uniqueSignatures!==graphs.length)errors.push(`expected ${graphs.length} distinct page graph signatures, got ${uniqueSignatures}`);
for(const graph of graphs)if(graph.readiness!=="READY")errors.push(`${graph.category}: fixture graph is ${graph.readiness}`);
const output=resolve("artifacts/v2/complete-page-graph-receipt.json");
await mkdir(resolve("artifacts/v2"),{recursive:true});
const receipt={schema:"website-design-compiler/page-graph-receipt/v2",overall:errors.length===0?"PASS":"FAIL",categoryCount:graphs.length,uniqueSignatures,graphs:graphs.map((graph)=>({category:graph.category,readiness:graph.readiness,sectionCount:graph.nodes.length,semanticOrder:graph.semanticOrder,conversionPath:graph.conversionPath,signature:graph.signature})),errors};
await writeFile(output,JSON.stringify(receipt,null,2)+"\n","utf8");
console.log(JSON.stringify({overall:receipt.overall,categoryCount:receipt.categoryCount,uniqueSignatures:receipt.uniqueSignatures}));
if(receipt.overall!=="PASS")process.exitCode=1;
