import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileResponsivePageGraph, compileResponsiveRegistry } from "../src/responsive-composition.js";
import { validateAgainstSchema } from "../src/validate.js";

const registry=compileResponsiveRegistry();
const pages=compileAllSectionPageFixtures().map(compileResponsivePageGraph);
await Promise.all(pages.map((page)=>validateAgainstSchema(page,"responsive-page-graph-v2.schema.json")));
const semanticOrderPass=pages.every((page)=>page.mobile.map((entry)=>entry.id).join("|")===page.semanticOrder.join("|")&&page.tablet.map((entry)=>entry.id).join("|")===page.semanticOrder.join("|")&&page.desktop.map((entry)=>entry.id).join("|")===page.semanticOrder.join("|"));
const structuralDifferences=pages.map((page)=>({category:page.category,different:JSON.stringify(page.mobile)!==JSON.stringify(page.desktop)}));
const overall=registry.length===18&&pages.length===6&&semanticOrderPass&&structuralDifferences.every((entry)=>entry.different)&&registry.every((policy)=>policy.coarsePointer.hoverRequired===false&&policy.reducedMotion.essentialOnly===true)?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/responsive-composition-receipt/v2",overall,registryCoverage:registry.length,pageCoverage:pages.length,semanticOrderPass,structuralDifferences,registry,pages};
const dir=resolve("artifacts/v2/responsive-composition");await mkdir(dir,{recursive:true});await writeFile(resolve(dir,"receipt.json"),`${JSON.stringify(receipt,null,2)}\n`);console.log(JSON.stringify({overall,registryCoverage:registry.length,pageCoverage:pages.length,semanticOrderPass,structuralDifferences}));if(overall!=="PASS")process.exitCode=1;
