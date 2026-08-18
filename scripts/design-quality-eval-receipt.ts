import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { evaluateDesignQuality, type OriginalitySubject, type QualityViewport, type VisualQualityObservation } from "../src/design-quality-eval.js";
import { validateDesignQualityReleaseProfile, type DesignQualityReleaseProfile } from "../src/design-quality-profile.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding, type ExpectedDesignQualityEvidence } from "../src/design-quality-evidence.js";

interface GeneratedPageEvidence{category:string;project:string;path:string;sha256:string;observationPath:string;observationSha256:string}
interface GeneratedPageReceipt{schema:string;overall:string;git:{sha:string;ref:string};evidence:GeneratedPageEvidence[]}
interface TokenReceiptEntry{id:string;state:string}
interface TokenReceipt{schema:string;overall:string;categories:TokenReceiptEntry[]}
interface VisualDirectionReceipt{overall:string;categories:Array<{id:string;originalityState:string;observedReferenceCount:number}>}
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
const profilePath=join(process.cwd(),"fixtures","v2","release-profiles","premium.json");
const profileBytes=await readFile(profilePath);
const profile=JSON.parse(profileBytes.toString("utf8")) as DesignQualityReleaseProfile;
const profileErrors=validateDesignQualityReleaseProfile(profile);
if(profileErrors.length>0)throw new Error(`invalid design-quality release profile: ${profileErrors.join("; ")}`);
const generatedReceipt=JSON.parse(await readFile(join(process.cwd(),"artifacts","generated-pages","generated-page-browser-receipt.json"),"utf8")) as GeneratedPageReceipt;
const tokenReceipt=JSON.parse(await readFile(join(process.cwd(),"artifacts","v2","semantic-design-tokens","receipt.json"),"utf8")) as TokenReceipt;
const visualDirectionReceipt=JSON.parse(await readFile(join(process.cwd(),"artifacts","v2","visual-direction-search","receipt.json"),"utf8")) as VisualDirectionReceipt;
if(tokenReceipt.overall!=="PASS")throw new Error(`semantic-token benchmark receipt is ${tokenReceipt.overall}`);
if(visualDirectionReceipt.overall!=="PASS")throw new Error(`visual-direction benchmark receipt is ${visualDirectionReceipt.overall}`);
const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
const corpus:OriginalitySubject[]=graphs.map((graph)=>({id:graph.category,signature:graph.signature}));
const evaluations=[];
for(const graph of graphs){
  const tokenEntry=tokenEntryFor(graph.category,tokenReceipt);
  const originalityCorpus=corpus.filter((entry)=>entry.id!==graph.category);
  for(const viewport of profile.requiredViewports as readonly QualityViewport[]){
    const project=viewport==="mobile"?"mobile-chromium":"desktop-chromium";
    const screenshotEvidence=generatedReceipt.evidence.find((entry)=>entry.category===graph.category&&entry.project===project);
    const graphSha256=sha256(JSON.stringify(graph));
    const tokenPath=join(process.cwd(),"artifacts","v2","semantic-design-tokens",`${tokenEntry.id}.json`);
    const tokenBytes=await readFile(tokenPath);
    const designTokensSha256=sha256(tokenBytes);
    let screenshotSha256="";
    let screenshotPath="";
    let visualObservation:VisualQualityObservation|undefined;
    if(screenshotEvidence){
      screenshotPath=`artifacts/generated-pages/${screenshotEvidence.path}`;
      screenshotSha256=sha256(await readFile(join(process.cwd(),"artifacts","generated-pages",screenshotEvidence.path)));
      const observationBytes=await readFile(join(process.cwd(),"artifacts","generated-pages",screenshotEvidence.observationPath));
      if(sha256(observationBytes)!==screenshotEvidence.observationSha256)throw new Error(`${graph.category}/${viewport}: visual observation hash mismatch`);
      visualObservation=JSON.parse(observationBytes.toString("utf8")) as VisualQualityObservation;
      if(visualObservation.category!==graph.category||visualObservation.project!==project)throw new Error(`${graph.category}/${viewport}: visual observation identity mismatch`);
    }
    const card=evaluateDesignQuality(graph,viewport,profile.premiumQualityThreshold,[],originalityCorpus,profile.originalitySimilarityThreshold,visualObservation);
    const expected:ExpectedDesignQualityEvidence={category:graph.category,viewport,pageGraphSha256:graphSha256,designTokensSha256,screenshotSha256:screenshotEvidence?.sha256??"",gitSha,graphSignature:graph.signature};
    const binding:DesignQualityEvidenceBinding={schema:"website-design-compiler/design-quality-evidence/v2",category:graph.category,viewport,pageGraphSha256:graphSha256,designTokensSha256,screenshotSha256,gitSha,graphSignature:graph.signature,screenshotPath};
    const decision=decidePremiumQuality(card,binding,expected,profile.premiumQualityThreshold);
    const suppliedReferenceAudit=visualDirectionReceipt.categories.find((entry)=>entry.id===graph.category);
    evaluations.push({card,binding,decision,suppliedReferenceAudit,source:{generatedPageReceipt:generatedReceipt.schema,generatedPageReceiptGitSha:generatedReceipt.git.sha,semanticTokenReceipt:tokenReceipt.schema,tokenArtifactId:tokenEntry.id,tokenPath:`artifacts/v2/semantic-design-tokens/${tokenEntry.id}.json`,visualObservationPath:screenshotEvidence?.observationPath??"ABSENT",originalityCorpus:originalityCorpus.map((entry)=>entry.id)}});
  }
}
const categories=new Set(evaluations.map((entry)=>entry.card.category));
const viewportCoverage={mobile:evaluations.filter((entry)=>entry.card.viewport==="mobile").length,desktop:evaluations.filter((entry)=>entry.card.viewport==="desktop").length};
const exactHeadBound=generatedReceipt.overall==="PASS"&&generatedReceipt.git.sha===gitSha&&/^[a-f0-9]{40}$/.test(gitSha);
const allEvidenceBound=evaluations.every((entry)=>entry.decision.evidenceState==="PASS");
const allStructuralPass=evaluations.every((entry)=>entry.decision.structuralState==="PASS");
const allOriginalityPass=evaluations.every((entry)=>entry.card.originalityAudit.state==="PASS"&&entry.suppliedReferenceAudit?.originalityState==="PASS"&&(entry.suppliedReferenceAudit.observedReferenceCount??0)>0);
const premiumPass=evaluations.every((entry)=>entry.decision.overall==="PREMIUM_PASS");
const expectedEvaluationCount=graphs.length*profile.requiredViewports.length;
const overall=categories.size===6&&evaluations.length===expectedEvaluationCount&&viewportCoverage.mobile===6&&viewportCoverage.desktop===6&&exactHeadBound&&allEvidenceBound&&allStructuralPass&&allOriginalityPass&&premiumPass?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/design-quality-eval-receipt/v2",overall,git:{sha:gitSha,ref:process.env.GITHUB_REF??"UNBOUND"},releaseProfile:{schema:profile.schema,id:profile.id,sha256:sha256(profileBytes),premiumQualityThreshold:profile.premiumQualityThreshold,originalitySimilarityThreshold:profile.originalitySimilarityThreshold,requiredViewports:profile.requiredViewports,requireExactEvidenceBinding:profile.requireExactEvidenceBinding},categoryCount:categories.size,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,allOriginalityPass,premium:{state:premiumPass?"PASS":"FAIL",evaluations}};
const path=join(outputDirectory,"design-quality-eval-receipt.json");
await writeFile(path,`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
console.log(JSON.stringify({path,overall:receipt.overall,profile:receipt.releaseProfile,categoryCount:receipt.categoryCount,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,allOriginalityPass,premium:receipt.premium.state,scores:evaluations.map((entry)=>({category:entry.card.category,viewport:entry.card.viewport,score:entry.card.score,originality:entry.card.originalityAudit.state,maxCorpusSimilarity:entry.card.originalityAudit.maxCorpusSimilarity,state:entry.decision.overall}))}));
if(receipt.overall!=="PASS")process.exitCode=1;
