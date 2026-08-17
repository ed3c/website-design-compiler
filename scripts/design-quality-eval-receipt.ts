import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { evaluateDesignQuality, type QualityViewport } from "../src/design-quality-eval.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding, type ExpectedDesignQualityEvidence } from "../src/design-quality-evidence.js";

interface GeneratedPageEvidence{category:string;project:string;path:string;sha256:string}
interface GeneratedPageReceipt{schema:string;overall:string;git:{sha:string;ref:string};evidence:GeneratedPageEvidence[]}
const sha256=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const outputDirectory=join(process.cwd(),"artifacts","v2","design-quality");
await mkdir(outputDirectory,{recursive:true});
const gitSha=process.env.GITHUB_SHA??"UNBOUND";
const generatedReceipt=JSON.parse(await readFile(join(process.cwd(),"artifacts","generated-pages","generated-page-browser-receipt.json"),"utf8")) as GeneratedPageReceipt;
const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
const evaluations=[];
for(const graph of graphs){
  for(const viewport of ["mobile","desktop"] as const satisfies readonly QualityViewport[]){
    const card=evaluateDesignQuality(graph,viewport);
    const project=viewport==="mobile"?"mobile-chromium":"desktop-chromium";
    const screenshotEvidence=generatedReceipt.evidence.find((entry)=>entry.category===graph.category&&entry.project===project);
    const graphSha256=sha256(JSON.stringify(graph));
    const tokenPath=join(process.cwd(),"artifacts","v2","semantic-design-tokens",`${graph.category}.json`);
    const tokenBytes=await readFile(tokenPath);
    const designTokensSha256=sha256(tokenBytes);
    let screenshotSha256="";
    let screenshotPath="";
    if(screenshotEvidence){
      screenshotPath=`artifacts/generated-pages/${screenshotEvidence.path}`;
      screenshotSha256=sha256(await readFile(join(process.cwd(),"artifacts","generated-pages",screenshotEvidence.path)));
    }
    const expected:ExpectedDesignQualityEvidence={category:graph.category,viewport,pageGraphSha256:graphSha256,designTokensSha256,screenshotSha256:screenshotEvidence?.sha256??"",gitSha,graphSignature:graph.signature};
    const binding:DesignQualityEvidenceBinding={schema:"website-design-compiler/design-quality-evidence/v2",category:graph.category,viewport,pageGraphSha256:graphSha256,designTokensSha256,screenshotSha256,gitSha,graphSignature:graph.signature,screenshotPath};
    const decision=decidePremiumQuality(card,binding,expected);
    evaluations.push({card,binding,decision,source:{generatedPageReceipt:generatedReceipt.schema,generatedPageReceiptGitSha:generatedReceipt.git.sha,tokenPath:`artifacts/v2/semantic-design-tokens/${graph.category}.json`}});
  }
}
const categories=new Set(evaluations.map((entry)=>entry.card.category));
const viewportCoverage={mobile:evaluations.filter((entry)=>entry.card.viewport==="mobile").length,desktop:evaluations.filter((entry)=>entry.card.viewport==="desktop").length};
const exactHeadBound=generatedReceipt.overall==="PASS"&&generatedReceipt.git.sha===gitSha&&/^[a-f0-9]{40}$/.test(gitSha);
const allEvidenceBound=evaluations.every((entry)=>entry.decision.evidenceState==="PASS");
const allStructuralPass=evaluations.every((entry)=>entry.decision.structuralState==="PASS");
const premiumPass=evaluations.every((entry)=>entry.decision.overall==="PREMIUM_PASS");
const overall=categories.size===6&&viewportCoverage.mobile===6&&viewportCoverage.desktop===6&&exactHeadBound&&allEvidenceBound&&allStructuralPass&&premiumPass?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/design-quality-eval-receipt/v2",overall,git:{sha:gitSha,ref:process.env.GITHUB_REF??"UNBOUND"},threshold:78,categoryCount:categories.size,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,premium:{state:premiumPass?"PASS":"FAIL",evaluations}};
const path=join(outputDirectory,"design-quality-eval-receipt.json");
await writeFile(path,`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
console.log(JSON.stringify({path,overall:receipt.overall,categoryCount:receipt.categoryCount,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,premium:receipt.premium.state}));
if(receipt.overall!=="PASS")process.exitCode=1;
