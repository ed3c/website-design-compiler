import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateAgainstSchema } from "../src/validate.js";
import { ARENA_CATEGORIES } from "../src/arena.js";

const categories=ARENA_CATEGORIES;
const projects=["desktop-chromium","tablet-chromium","mobile-chromium"] as const;
const root=join(process.cwd(),"artifacts","generated-pages");
const screenshotsRoot=join(root,"screenshots");
await mkdir(root,{recursive:true});
const evidence=[] as Array<{category:string;project:string;path:string;sha256:string;observationPath:string;observationSha256:string}>;
const missing:string[]=[];
for(const project of projects){
  for(const category of categories){
    const name=`${project}--${category}.png`;
    const path=join(screenshotsRoot,name);
    try{
      const bytes=await readFile(path);
      const observationName=`${project}--${category}.json`;
      const observationBytes=await readFile(join(root,"observations",observationName));
      const observation=JSON.parse(observationBytes.toString("utf8")) as {category?:string;project?:string};
      await validateAgainstSchema(observation,"generated-page-visual-observation.schema.json");
      if(observation.category!==category||observation.project!==project)throw new Error(`${observationName}: observation identity mismatch`);
      evidence.push({category,project,path:`screenshots/${name}`,sha256:createHash("sha256").update(bytes).digest("hex"),observationPath:`observations/${observationName}`,observationSha256:createHash("sha256").update(observationBytes).digest("hex")});
    }catch{missing.push(name);}
  }
}
const distinctCategories=new Set(evidence.map((entry)=>entry.category)).size;
const distinctProjects=new Set(evidence.map((entry)=>entry.project)).size;
const distinctHashes=new Set(evidence.map((entry)=>entry.sha256)).size;
const overall=missing.length===0&&evidence.length===18&&distinctCategories===6&&distinctProjects===3&&distinctHashes>=6?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/generated-page-browser-receipt/v2",overall,git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"},expected:{categories:6,projects:3,screenshots:18},observed:{categories:distinctCategories,projects:distinctProjects,screenshots:evidence.length,distinctHashes},evidence,missing};
const receiptPath=join(root,"generated-page-browser-receipt.json");
await writeFile(receiptPath,`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
console.log(JSON.stringify({receiptPath,overall,evidenceCount:evidence.length,distinctHashes,missingCount:missing.length}));
if(overall!=="PASS")process.exitCode=1;
