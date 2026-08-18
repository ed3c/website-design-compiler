import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateAgainstSchema } from "../src/validate.js";

const categories=["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"] as const;
const projects=["desktop-chromium","tablet-chromium","mobile-chromium"] as const;
const root=join(process.cwd(),"artifacts","generated-pages");
const screenshotsRoot=join(root,"screenshots");
await mkdir(root,{recursive:true});
const evidence=[] as Array<{category:string;project:string;path:string;sha256:string}>;
const qualityEvidence=[] as Array<{category:string;project:string;viewport:"mobile"|"desktop";path:string;sha256:string;screenshotSha256:string}>;
const missing:string[]=[];
for(const project of projects){
  for(const category of categories){
    const name=`${project}--${category}.png`;
    const path=join(screenshotsRoot,name);
    try{
      const bytes=await readFile(path);
      evidence.push({category,project,path:`screenshots/${name}`,sha256:createHash("sha256").update(bytes).digest("hex")});
    }catch(error:unknown){if((error as NodeJS.ErrnoException).code==="ENOENT")missing.push(name);else throw error;}
  }
}
for(const project of ["desktop-chromium","mobile-chromium"] as const){
  for(const category of categories){
    const name=`${project}--${category}.json`;
    const path=join(process.cwd(),"artifacts","design-quality-browser",name);
    try{
      const bytes=await readFile(path);
      const observation=await validateAgainstSchema<{schema:string;category:string;project:string;viewport:"mobile"|"desktop";screenshot:{sha256:string}}>(JSON.parse(bytes.toString("utf8")),"design-quality-browser-observation.schema.json");
      if(observation.category!==category||observation.project!==project)throw new Error(`${name}: observation identity mismatch`);
      qualityEvidence.push({category,project,viewport:observation.viewport,path:`../design-quality-browser/${name}`,sha256:createHash("sha256").update(bytes).digest("hex"),screenshotSha256:observation.screenshot.sha256});
    }catch(error:unknown){if((error as NodeJS.ErrnoException).code==="ENOENT")missing.push(`design-quality-browser/${name}`);else throw error;}
  }
}
const distinctCategories=new Set(evidence.map((entry)=>entry.category)).size;
const distinctProjects=new Set(evidence.map((entry)=>entry.project)).size;
const distinctHashes=new Set(evidence.map((entry)=>entry.sha256)).size;
const overall=missing.length===0&&evidence.length===18&&qualityEvidence.length===12&&distinctCategories===6&&distinctProjects===3&&distinctHashes>=6?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/generated-page-browser-receipt/v3",overall,git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"},expected:{categories:6,projects:3,screenshots:18,qualityObservations:12},observed:{categories:distinctCategories,projects:distinctProjects,screenshots:evidence.length,distinctHashes,qualityObservations:qualityEvidence.length},evidence,qualityEvidence,missing};
await validateAgainstSchema(receipt,"generated-page-browser-receipt-v3.schema.json");
const receiptPath=join(root,"generated-page-browser-receipt.json");
await writeFile(receiptPath,`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
console.log(JSON.stringify({receiptPath,overall,evidenceCount:evidence.length,qualityEvidenceCount:qualityEvidence.length,distinctHashes,missingCount:missing.length}));
if(overall!=="PASS")process.exitCode=1;
