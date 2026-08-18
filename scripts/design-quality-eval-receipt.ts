import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompletePageGraph } from "../src/complete-page-graph.js";
import { evaluateDesignQuality, evaluateDesignQualityV3, type OriginalitySubject, type QualityViewport } from "../src/design-quality-eval.js";
import type { DesignQualityBrowserObservation,RuntimeTokenMatch,VisualOriginalitySubject } from "../src/design-quality-observation.js";
import { validateDesignQualityReleaseProfile, type AnyDesignQualityReleaseProfile } from "../src/design-quality-profile.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding, type ExpectedDesignQualityEvidence } from "../src/design-quality-evidence.js";
import { validateAgainstSchema } from "../src/validate.js";

interface GeneratedPageEvidence{category:string;project:string;path:string;sha256:string}
interface QualityEvidence{category:string;project:string;viewport:QualityViewport;path:string;sha256:string;screenshotSha256:string}
interface GeneratedPageReceipt{schema:string;overall:string;git:{sha:string;ref:string};evidence:GeneratedPageEvidence[];qualityEvidence:QualityEvidence[]}
const sha256=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const v3Mode=process.env.DESIGN_QUALITY_EVALUATOR_VERSION==="v3";
type SemanticTokens={color:{background:string;surface:string;text:string;mutedText:string;accent:string;onAccent:string;focus:string};typography:{display:{family:string};body:{family:string}};layout:{containerMaxPx:{mobile:number;desktop:number};gutterPx:{mobile:number;desktop:number}};motionMs:{fast:number;base:number}};
function normalized(value:string):string{return value.toLowerCase().replace(/[\s"']/g,"");}
function runtimeTokenMatch(tokens:SemanticTokens,observation:DesignQualityBrowserObservation):RuntimeTokenMatch{
  const viewport=observation.viewport;const actual=observation.computed.cssTokens;
  const expected:Record<string,string>={"--wdc-color-background":tokens.color.background,"--wdc-color-surface":tokens.color.surface,"--wdc-color-text-primary":tokens.color.text,"--wdc-color-text-muted":tokens.color.mutedText,"--wdc-color-accent":tokens.color.accent,"--wdc-color-on-accent":tokens.color.onAccent,"--wdc-color-focus":tokens.color.focus,"--wdc-font-display":tokens.typography.display.family,"--wdc-font-body":tokens.typography.body.family,"--wdc-motion-fast":`${tokens.motionMs.fast}ms`,"--wdc-motion-base":`${tokens.motionMs.base}ms`,"--wdc-container-max":`${tokens.layout.containerMaxPx[viewport]}px`,"--wdc-gutter":`${tokens.layout.gutterPx[viewport]}px`};
  const mismatches=Object.entries(expected).filter(([name,value])=>name.startsWith("--wdc-font-")?!normalized(actual[name]??"").startsWith(normalized(value)):normalized(actual[name]??"")!==normalized(value)).map(([name,value])=>`${name}:${actual[name]??"ABSENT"}!=${value}`);
  return{state:mismatches.length===0?"PASS":"FAIL",matched:Object.keys(expected).length-mismatches.length,total:Object.keys(expected).length,mismatches};
}
const outputDirectory=join(process.cwd(),"artifacts",v3Mode?"v3":"v2","design-quality");
await mkdir(outputDirectory,{recursive:true});
const gitSha=process.env.GITHUB_SHA??"UNBOUND";
const profilePath=join(process.cwd(),"fixtures",v3Mode?"v3":"v2","release-profiles","premium.json");
const profileBytes=await readFile(profilePath);
const profile=JSON.parse(profileBytes.toString("utf8")) as AnyDesignQualityReleaseProfile;
const profileErrors=validateDesignQualityReleaseProfile(profile);
if(profileErrors.length>0)throw new Error(`invalid design-quality release profile: ${profileErrors.join("; ")}`);
if(v3Mode&&profile.schema!=="website-design-compiler/design-quality-release-profile/v3")throw new Error("v3 evaluator requires the premium v3 release profile");
if(!v3Mode&&profile.schema!=="website-design-compiler/design-quality-release-profile/v2")throw new Error("v2 evaluator requires the premium v2 release profile");
if(v3Mode)await validateAgainstSchema(profile,"design-quality-release-profile-v3.schema.json");
const generatedReceipt=JSON.parse(await readFile(join(process.cwd(),"artifacts","generated-pages","generated-page-browser-receipt.json"),"utf8")) as GeneratedPageReceipt;
if(generatedReceipt.schema!=="website-design-compiler/generated-page-browser-receipt/v3")throw new Error(`generated page receipt schema is ${generatedReceipt.schema}`);
const productionProjectionPath=join(process.cwd(),"apps","site","generated","benchmark-page-graphs.json");
const productionProjectionBytes=await readFile(productionProjectionPath);
const productionProjectionSha256=sha256(productionProjectionBytes);
const projection=JSON.parse(productionProjectionBytes.toString("utf8")) as {schema:string;source:string;graphs:Record<string,CompletePageGraph>;designTokens:Record<string,SemanticTokens>};
if(projection.schema!=="website-design-compiler/site-page-graph-projection/v2"||projection.source!=="production-site-compiler")throw new Error("design-quality evaluation requires the production site graph projection");
const graphs=Object.values(projection.graphs);
if(graphs.some((graph)=>graph.source.mode!=="PRODUCTION"||graph.readiness!=="READY"||graph.missingEvidence.length>0))throw new Error("design-quality evaluation requires READY production page graphs with no missing evidence");
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
  const originalityCorpus=corpus.filter((entry)=>entry.id!==graph.category);
  for(const viewport of profile.requiredViewports as readonly QualityViewport[]){
    const project=viewport==="mobile"?"mobile-chromium":"desktop-chromium";
    const qualityEvidence=generatedReceipt.qualityEvidence.find((entry)=>entry.category===graph.category&&entry.project===project&&entry.viewport===viewport);
    const observed=observations.get(`${graph.category}:${viewport}`);
    if(!qualityEvidence||!observed)throw new Error(`${graph.category}/${viewport}: browser quality observation absent`);
    const graphSha256=sha256(JSON.stringify(graph));
    const tokens=projection.designTokens[graph.category];
    if(!tokens)throw new Error(`${graph.category}: production semantic tokens absent from site projection`);
    const designTokensSha256=sha256(JSON.stringify(tokens));
    if(designTokensSha256!==graph.source.artifacts.semanticDesignTokens)throw new Error(`${graph.category}: semantic-token artifact drifted from the production page graph source binding`);
    const tokenMatch=runtimeTokenMatch(tokens,observed.observation);
    const visualCorpus:VisualOriginalitySubject[]=[...observations.values()].map((entry)=>entry.observation).filter((entry)=>entry.viewport===viewport&&entry.category!==graph.category).map((observation)=>({id:observation.category,observation}));
    const card=v3Mode?evaluateDesignQualityV3(graph,viewport,{premiumQualityThreshold:profile.premiumQualityThreshold,originalitySimilarityThreshold:profile.originalitySimilarityThreshold,structuralCorpus:graphs.filter((entry)=>entry.category!==graph.category).map((entry)=>({id:entry.category,graph:entry})),observation:observed.observation,tokenMatch,visualCorpus}):evaluateDesignQuality(graph,viewport,profile.premiumQualityThreshold,[],originalityCorpus,profile.originalitySimilarityThreshold,observed.observation,tokenMatch,[],visualCorpus);
    const screenshotPath=observed.observation.screenshot.path;
    const screenshotSha256=observed.observation.screenshot.sha256;
    const expected:ExpectedDesignQualityEvidence={category:graph.category,viewport,pageGraphSha256:graphSha256,designTokensSha256,screenshotSha256,gitSha,graphSignature:graph.signature};
    const binding:DesignQualityEvidenceBinding={schema:"website-design-compiler/design-quality-evidence/v2",category:graph.category,viewport,pageGraphSha256:graphSha256,designTokensSha256,screenshotSha256,gitSha,graphSignature:graph.signature,screenshotPath};
    const decision=decidePremiumQuality(card,binding,expected,profile.premiumQualityThreshold);
    evaluations.push({card,binding,decision,source:{generatedPageReceipt:generatedReceipt.schema,generatedPageReceiptGitSha:generatedReceipt.git.sha,qualityObservationPath:qualityEvidence.path,qualityObservationSha256:observed.fileSha256,productionProjection:projection.schema,productionProjectionPath:"apps/site/generated/benchmark-page-graphs.json",productionProjectionSha256,semanticTokensSourceSha256:designTokensSha256,structuralOriginalityCorpus:originalityCorpus.map((entry)=>entry.id),visualOriginalityCorpus:visualCorpus.map((entry)=>entry.id)}});
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
let calibration:null|{state:"PASS"|"FAIL";path:string;schema:string;sha256:string;exactObservationSetBound:boolean}=null;
if(v3Mode&&profile.schema==="website-design-compiler/design-quality-release-profile/v3"){
  const calibrationPath=join(process.cwd(),profile.calibrationReceipt.path);const bytes=await readFile(calibrationPath);
  const value=await validateAgainstSchema<{schema:string;overall:"PASS"|"FAIL";git:{sha:string};exactHeadBound:boolean;threshold:number;methods:typeof profile.evaluator;sources:{projection:{sha256:string};observations:Array<{category:string;viewport:string;sha256:string;screenshotSha256:string}>}}>(JSON.parse(bytes.toString("utf8")),"design-quality-calibration-receipt-v2.schema.json");
  const expectedObservationSet=[...observations.entries()].map(([identity,entry])=>`${identity}:${entry.fileSha256}:${entry.observation.screenshot.sha256}`).sort();
  const calibratedObservationSet=value.sources.observations.map((entry)=>`${entry.category}:${entry.viewport}:${entry.sha256}:${entry.screenshotSha256}`).sort();
  const exactObservationSetBound=JSON.stringify(expectedObservationSet)===JSON.stringify(calibratedObservationSet)&&value.sources.projection.sha256===productionProjectionSha256;
  const expectedMethods={scoreModel:profile.evaluator.scoreModel,structuralSimilarity:profile.evaluator.structuralSimilarity,visualSimilarity:profile.evaluator.visualSimilarity};
  const state=value.overall==="PASS"&&value.exactHeadBound&&value.git.sha===gitSha&&value.threshold===profile.originalitySimilarityThreshold&&JSON.stringify(value.methods)===JSON.stringify(expectedMethods)&&exactObservationSetBound?"PASS":"FAIL";
  calibration={state,path:profile.calibrationReceipt.path,schema:value.schema,sha256:sha256(bytes),exactObservationSetBound};
}
const calibrationBound=!v3Mode||calibration?.state==="PASS";
const overall=categories.size===6&&evaluations.length===expectedEvaluationCount&&viewportCoverage.mobile===6&&viewportCoverage.desktop===6&&exactHeadBound&&calibrationBound&&allEvidenceBound&&allStructuralPass&&allOriginalityPass&&allMeasurementsPass&&premiumPass?"PASS":"FAIL";
const releaseProfile=v3Mode&&profile.schema==="website-design-compiler/design-quality-release-profile/v3"?{schema:profile.schema,id:profile.id,sha256:sha256(profileBytes),premiumQualityThreshold:profile.premiumQualityThreshold,originalitySimilarityThreshold:profile.originalitySimilarityThreshold,requiredViewports:profile.requiredViewports,requireExactEvidenceBinding:profile.requireExactEvidenceBinding,evaluator:profile.evaluator,calibrationReceipt:profile.calibrationReceipt}:{schema:profile.schema,id:profile.id,sha256:sha256(profileBytes),premiumQualityThreshold:profile.premiumQualityThreshold,originalitySimilarityThreshold:profile.originalitySimilarityThreshold,requiredViewports:profile.requiredViewports,requireExactEvidenceBinding:profile.requireExactEvidenceBinding};
const receipt=v3Mode?{schema:"website-design-compiler/design-quality-eval-receipt/v3",overall,git:{sha:gitSha,ref:process.env.GITHUB_REF??"UNBOUND"},releaseProfile,calibration,categoryCount:categories.size,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,allOriginalityPass,allMeasurementsPass,premium:{state:premiumPass?"PASS":"FAIL",evaluations}}:{schema:"website-design-compiler/design-quality-eval-receipt/v2",overall,git:{sha:gitSha,ref:process.env.GITHUB_REF??"UNBOUND"},releaseProfile,categoryCount:categories.size,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,allOriginalityPass,allMeasurementsPass,premium:{state:premiumPass?"PASS":"FAIL",evaluations}};
await validateAgainstSchema(receipt,v3Mode?"design-quality-eval-receipt-v3.schema.json":"design-quality-eval-receipt.schema.json");
const path=join(outputDirectory,"design-quality-eval-receipt.json");
await writeFile(path,`${JSON.stringify(receipt,null,2)}\n`,`utf8`);
console.log(JSON.stringify({path,overall:receipt.overall,profile:receipt.releaseProfile,...(v3Mode?{calibration}:{}),categoryCount:receipt.categoryCount,viewportCoverage,exactHeadBound,allEvidenceBound,allStructuralPass,allOriginalityPass,allMeasurementsPass,premium:receipt.premium.state,scores:evaluations.map((entry)=>({category:entry.card.category,viewport:entry.card.viewport,score:entry.card.score,measurement:entry.card.measurement.state,tokenMatch:entry.card.measurement.tokenMatch?.state,originality:entry.card.originalityAudit.state,maxStructuralCorpusSimilarity:entry.card.originalityAudit.maxCorpusSimilarity,maxVisualCorpusSimilarity:entry.card.originalityAudit.maxVisualCorpusSimilarity,state:entry.decision.overall}))}));
if(receipt.overall!=="PASS")process.exitCode=1;
