import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { evaluateDesignQuality, type OriginalitySubject, type QualityViewport } from "../src/design-quality-eval.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding, type ExpectedDesignQualityEvidence } from "../src/design-quality-evidence.js";

interface GeneratedPageEvidence{category:string;project:string;path:string;sha256:string}
interface GeneratedPageReceipt{schema:string;overall:string;git:{sha:string;ref:string};evidence:GeneratedPageEvidence[]}
interface TokenReceiptEntry{id:string;state:string}
interface TokenReceipt{schema:string;overall:string;categories:TokenReceiptEntry[]}
const sha256=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
function tokenEntryFor(category:string,receipt:TokenReceipt):TokenReceiptEntry{
  const matches=receipt.categories.filter((entry)=>entry.id===category||entry.id.startsWith(`${category}-`));
  if(matches.length!==1)throw new Error(`${category}: expected exactly one semantic-token receipt identity, got ${matches.map((entry)=>entry.id).join(",")||"none"}`);
  const entry=matches[0]!;
  if(entry.state!=="PASS")throw new Error(`${category}: semantic-token receipt ${entry.id} is ${entry.state}`);
  return entry;
}
const outputDirectory=join(process.cwd(),"artifacts","v2","design-quality");
await mkdir(outputDirectory,{recursive:true});
const gitSha=process.env.GITHUB_SHA??"UNBOUND";
const generatedReceipt=JSON.parse(await readFile(join(process.cwd(),"artifacts","generated-pages","generated-page-browser-receipt.json"),"utf8")) as GeneratedPageReceipt;
const tokenReceipt=JSON.parse(await readFile(join(process.cwd(),"artifacts","v2","semantic-design-tokens","receipt.json"),"utf8")) as TokenReceipt;
if(tokenReceipt.overall!=="PASS")throw new Error(`semantic-token benchmark receipt is ${tokenReceipt.overall}`);
const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
const corpus:OriginalitySubject[]=graphs.map((graph)=>({id:graph.category,signature:graph.signature}));
const evaluations=[];
for(const graph of graphs){
  const tokenEntry=tokenEntryFor(graph.category,tokenReceipt);
  const originalityCorpus=corpus.filter((entry)=>entry.id!==graph.category);
  for(const viewport of ["mobile","desktop"] as const satisfies readonly QualityViewport[]){
    const card=evaluateDesignQuality(graph,viewport,78,[],originalityCorpus);
    const project=viewport==="mobile"?"mobile-chromium":"desktop-chromium";
    const screenshotEvidence=generatedReceipt.evidence.find((entry)=>entry.category===graph.category&&entry.project===project);
    const graphSha256=sha256(JSON.stringify(graph));
    const tokenPath=join(process.cwd(),"artifacts","v2","semantic-design-tokens",`${tokenEntry.id}.json`);
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
    evaluations.push({card,binding,decision,source:{generatedPageReceipt:generatedReceipt.schema,generatedPageReceiptGitSha:generatedReceipt.git.sha,semanticTokenReceipt:tokenReceipt.schema,tokenArtifactId:tokenEntry.id,tokenPath:`artifacts/v2/semantic-design-tokens/${tokenEntry.id}.json`,originalityCorpus:originalityCorpus.map((entry)=>entry.id)}});
  }
}
const categories=new Set(evaluations.map((entry)=>entry.card.category));
const viewportCoverage={mobile:evaluations.filter((entry)=>entry.card.viewport==="mobile").length,desktop:evaluations.filter((entry)=>entry.card.viewport==="desktop").length};
const exactHeadBound=generatedReceipt.overall==="PASS"&&generatedReceipt.git.sha===gitSha&&/^[a-f0-9]{40}$/.test(gitSha);
const allEvidenceBound=evaluations.every((entry)=>entry.decision.evidenceState==="PASS");
const allStructuralPass=evaluations.every((entry)=>entry.decision.structuralState==="PASS");
const allOriginalityPass=evaluations.every((entry)=>entry.card.originalityAudit.state==="PASS");
const premiumPass=evaluations.every((entry)=>entry.decision.overall==="PREMIUM_PASS");
const overall=categories.size===6&&viewportCoverage.mobile===6&&viewportCoverage.desktop===6&&exactHeadBound&&allEvidenceBound&&allStructuralPass&&allOriginalityPass&&premiumPass?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/design-quality-eval-receipt/v2",overall,git:{sha:gitSha,ref:process.env.GITHUB_REF??"UNBOUND"},threshold:78,categoryCount:categories.size,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,allOriginalityPass,premium:{state:premiumPass?"PASS":"FAIL",evaluations}};
const path=join(outputDirectory,"design-quality-eval-receipt.json");
await writeFile(path,`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
console.log(JSON.stringify({path,overall:receipt.overall,categoryCount:receipt.categoryCount,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,allOriginalityPass,premium:receipt.premium.state,scores:evaluations.map((entry)=>({category:entry.card.category,viewport:entry.card.viewport,score:entry.card.score,originality:entry.card.originalityAudit.state,maxCorpusSimilarity:entry.card.originalityAudit.maxCorpusSimilarity,state:entry.decision.overall}))}));
if(receipt.overall!=="PASS")process.exitCode=1;
