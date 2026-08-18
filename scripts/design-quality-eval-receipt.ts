import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { evaluateDesignQuality, type OriginalitySubject, type QualityViewport } from "../src/design-quality-eval.js";
import type { DesignQualityBrowserObservation,RuntimeTokenMatch,VisualOriginalitySubject } from "../src/design-quality-observation.js";
import { validateDesignQualityReleaseProfile, type DesignQualityReleaseProfile } from "../src/design-quality-profile.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding, type ExpectedDesignQualityEvidence } from "../src/design-quality-evidence.js";
import { validateAgainstSchema } from "../src/validate.js";

interface GeneratedPageEvidence{category:string;project:string;path:string;sha256:string}
interface QualityEvidence{category:string;project:string;viewport:QualityViewport;path:string;sha256:string;screenshotSha256:string}
interface GeneratedPageReceipt{schema:string;overall:string;git:{sha:string;ref:string};evidence:GeneratedPageEvidence[];qualityEvidence:QualityEvidence[]}
interface TokenReceiptEntry{id:string;state:string}
interface TokenReceipt{schema:string;overall:string;categories:TokenReceiptEntry[]}
const sha256=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
type SemanticTokens={color:{background:string;surface:string;text:string;mutedText:string;accent:string;onAccent:string;focus:string};typography:{display:{family:string};body:{family:string}};layout:{containerMaxPx:{mobile:number;desktop:number};gutterPx:{mobile:number;desktop:number}};motionMs:{fast:number;base:number}};
function normalized(value:string):string{return value.toLowerCase().replace(/[\s"']/g,"");}
function runtimeTokenMatch(tokens:SemanticTokens,observation:DesignQualityBrowserObservation):RuntimeTokenMatch{
  const viewport=observation.viewport;const actual=observation.computed.cssTokens;
  const expected:Record<string,string>={"--wdc-color-background":tokens.color.background,"--wdc-color-surface":tokens.color.surface,"--wdc-color-text-primary":tokens.color.text,"--wdc-color-text-muted":tokens.color.mutedText,"--wdc-color-accent":tokens.color.accent,"--wdc-color-on-accent":tokens.color.onAccent,"--wdc-color-focus":tokens.color.focus,"--wdc-font-display":tokens.typography.display.family,"--wdc-font-body":tokens.typography.body.family,"--wdc-motion-fast":`${tokens.motionMs.fast}ms`,"--wdc-motion-base":`${tokens.motionMs.base}ms`,"--wdc-container-max":`${tokens.layout.containerMaxPx[viewport]}px`,"--wdc-gutter":`${tokens.layout.gutterPx[viewport]}px`};
  const mismatches=Object.entries(expected).filter(([name,value])=>name.startsWith("--wdc-font-")?!normalized(actual[name]??"").startsWith(normalized(value)):normalized(actual[name]??"")!==normalized(value)).map(([name,value])=>`${name}:${actual[name]??"ABSENT"}!=${value}`);
  return{state:mismatches.length===0?"PASS":"FAIL",matched:Object.keys(expected).length-mismatches.length,total:Object.keys(expected).length,mismatches};
}
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
if(generatedReceipt.schema!=="website-design-compiler/generated-page-browser-receipt/v3")throw new Error(`generated page receipt schema is ${generatedReceipt.schema}`);
const tokenReceipt=JSON.parse(await readFile(join(process.cwd(),"artifacts","v2","semantic-design-tokens","receipt.json"),"utf8")) as TokenReceipt;
if(tokenReceipt.overall!=="PASS")throw new Error(`semantic-token benchmark receipt is ${tokenReceipt.overall}`);
const graphs=compileAllSectionPageFixtures().map(compileCompletePageGraph);
const corpus:OriginalitySubject[]=graphs.map((graph)=>({id:graph.category,signature:graph.signature}));
const observations=new Map<string,{observation:DesignQualityBrowserObservation;fileSha256:string}>();
for(const evidence of generatedReceipt.qualityEvidence){
  const path=join(process.cwd(),"artifacts","generated-pages",evidence.path);const bytes=await readFile(path);const fileSha256=sha256(bytes);
  if(fileSha256!==evidence.sha256)throw new Error(`${evidence.category}/${evidence.viewport}: quality observation digest mismatch`);
  const observation=await validateAgainstSchema<DesignQualityBrowserObservation>(JSON.parse(bytes.toString("utf8")),"design-quality-browser-observation.schema.json");
  if(observation.category!==evidence.category||observation.viewport!==evidence.viewport||observation.project!==evidence.project)throw new Error(`${evidence.category}/${evidence.viewport}: quality observation identity mismatch`);
  const screenshotBytes=await readFile(join(process.cwd(),observation.screenshot.path));
  if(sha256(screenshotBytes)!==observation.screenshot.sha256||observation.screenshot.sha256!==evidence.screenshotSha256)throw new Error(`${evidence.category}/${evidence.viewport}: quality screenshot digest mismatch`);
  observations.set(`${evidence.category}:${evidence.viewport}`,{observation,fileSha256});
}
const evaluations=[];
for(const graph of graphs){
  const tokenEntry=tokenEntryFor(graph.category,tokenReceipt);
  const originalityCorpus=corpus.filter((entry)=>entry.id!==graph.category);
  for(const viewport of profile.requiredViewports as readonly QualityViewport[]){
    const project=viewport==="mobile"?"mobile-chromium":"desktop-chromium";
    const qualityEvidence=generatedReceipt.qualityEvidence.find((entry)=>entry.category===graph.category&&entry.project===project&&entry.viewport===viewport);
    const observed=observations.get(`${graph.category}:${viewport}`);
    if(!qualityEvidence||!observed)throw new Error(`${graph.category}/${viewport}: browser quality observation absent`);
    const graphSha256=sha256(JSON.stringify(graph));
    const tokenPath=join(process.cwd(),"artifacts","v2","semantic-design-tokens",`${tokenEntry.id}.json`);
    const tokenBytes=await readFile(tokenPath);
    const tokens=JSON.parse(tokenBytes.toString("utf8")) as SemanticTokens;
    const designTokensSha256=sha256(tokenBytes);
    const tokenMatch=runtimeTokenMatch(tokens,observed.observation);
    const visualCorpus:VisualOriginalitySubject[]=[...observations.values()].map((entry)=>entry.observation).filter((entry)=>entry.viewport===viewport&&entry.category!==graph.category).map((observation)=>({id:observation.category,observation}));
    const card=evaluateDesignQuality(graph,viewport,profile.premiumQualityThreshold,[],originalityCorpus,profile.originalitySimilarityThreshold,observed.observation,tokenMatch,[],visualCorpus);
    const screenshotPath=observed.observation.screenshot.path;
    const screenshotSha256=observed.observation.screenshot.sha256;
    const expected:ExpectedDesignQualityEvidence={category:graph.category,viewport,pageGraphSha256:graphSha256,designTokensSha256,screenshotSha256,gitSha,graphSignature:graph.signature};
    const binding:DesignQualityEvidenceBinding={schema:"website-design-compiler/design-quality-evidence/v2",category:graph.category,viewport,pageGraphSha256:graphSha256,designTokensSha256,screenshotSha256,gitSha,graphSignature:graph.signature,screenshotPath};
    const decision=decidePremiumQuality(card,binding,expected,profile.premiumQualityThreshold);
    evaluations.push({card,binding,decision,source:{generatedPageReceipt:generatedReceipt.schema,generatedPageReceiptGitSha:generatedReceipt.git.sha,qualityObservationPath:qualityEvidence.path,qualityObservationSha256:observed.fileSha256,semanticTokenReceipt:tokenReceipt.schema,tokenArtifactId:tokenEntry.id,tokenPath:`artifacts/v2/semantic-design-tokens/${tokenEntry.id}.json`,structuralOriginalityCorpus:originalityCorpus.map((entry)=>entry.id),visualOriginalityCorpus:visualCorpus.map((entry)=>entry.id)}});
  }
}
const categories=new Set(evaluations.map((entry)=>entry.card.category));
const viewportCoverage={mobile:evaluations.filter((entry)=>entry.card.viewport==="mobile").length,desktop:evaluations.filter((entry)=>entry.card.viewport==="desktop").length};
const exactHeadBound=generatedReceipt.overall==="PASS"&&generatedReceipt.git.sha===gitSha&&/^[a-f0-9]{40}$/.test(gitSha);
const allEvidenceBound=evaluations.every((entry)=>entry.decision.evidenceState==="PASS");
const allStructuralPass=evaluations.every((entry)=>entry.decision.structuralState==="PASS");
const allOriginalityPass=evaluations.every((entry)=>entry.card.originalityAudit.state==="PASS");
const allMeasurementsPass=evaluations.every((entry)=>entry.card.measurement.state==="PASS");
const premiumPass=evaluations.every((entry)=>entry.decision.overall==="PREMIUM_PASS");
const expectedEvaluationCount=graphs.length*profile.requiredViewports.length;
const overall=categories.size===6&&evaluations.length===expectedEvaluationCount&&viewportCoverage.mobile===6&&viewportCoverage.desktop===6&&exactHeadBound&&allEvidenceBound&&allStructuralPass&&allOriginalityPass&&allMeasurementsPass&&premiumPass?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/design-quality-eval-receipt/v2",overall,git:{sha:gitSha,ref:process.env.GITHUB_REF??"UNBOUND"},releaseProfile:{schema:profile.schema,id:profile.id,sha256:sha256(profileBytes),premiumQualityThreshold:profile.premiumQualityThreshold,originalitySimilarityThreshold:profile.originalitySimilarityThreshold,requiredViewports:profile.requiredViewports,requireExactEvidenceBinding:profile.requireExactEvidenceBinding},categoryCount:categories.size,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,allOriginalityPass,allMeasurementsPass,premium:{state:premiumPass?"PASS":"FAIL",evaluations}};
await validateAgainstSchema(receipt,"design-quality-eval-receipt.schema.json");
const path=join(outputDirectory,"design-quality-eval-receipt.json");
await writeFile(path,`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
console.log(JSON.stringify({path,overall:receipt.overall,profile:receipt.releaseProfile,categoryCount:receipt.categoryCount,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,allOriginalityPass,allMeasurementsPass,premium:receipt.premium.state,scores:evaluations.map((entry)=>({category:entry.card.category,viewport:entry.card.viewport,score:entry.card.score,measurement:entry.card.measurement.state,tokenMatch:entry.card.measurement.tokenMatch?.state,originality:entry.card.originalityAudit.state,maxStructuralCorpusSimilarity:entry.card.originalityAudit.maxCorpusSimilarity,maxVisualCorpusSimilarity:entry.card.originalityAudit.maxVisualCorpusSimilarity,state:entry.decision.overall}))}));
if(receipt.overall!=="PASS")process.exitCode=1;
