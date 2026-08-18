import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAgainstSchema } from "../src/validate.js";

const evaluatorPath="artifacts/v3/design-quality/design-quality-eval-receipt.json";
const bindingPath="artifacts/handoff/issue-36-evidence-binding.json";
const arenaPath="artifacts/arena/arena-score.json";
const categories=["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"] as const;
type GitSubject={sha:string;ref:string;tree:string};
type Gate="PASS"|"FAIL";
const isRecord=(value:unknown):value is Record<string,any>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const sameGit=(value:unknown,git:GitSubject,tree=false)=>isRecord(value)&&value.sha===git.sha&&value.ref===git.ref&&(!tree||value.tree===git.tree);
const uniqueCoverage=(evaluations:any[])=>{
  const identities=new Set(evaluations.filter(isRecord).map((entry)=>`${entry.card?.category}:${entry.card?.viewport}`));
  return{categories:new Set(evaluations.map((entry)=>entry?.card?.category).filter((value)=>categories.includes(value))).size,mobile:categories.filter((category)=>identities.has(`${category}:mobile`)).length,desktop:categories.filter((category)=>identities.has(`${category}:desktop`)).length,evaluations:identities.size};
};

export function evaluateIssue36PremiumRelease(evaluator:unknown,binding:unknown,arena:unknown,git:GitSubject,evaluatorSha256:string){
  const failures:string[]=[];const evalValue=isRecord(evaluator)?evaluator:{};const bindingValue=isRecord(binding)?binding:{};const arenaValue=isRecord(arena)?arena:{};
  const evaluations=Array.isArray(evalValue.premium?.evaluations)?evalValue.premium.evaluations:[];const coverage=uniqueCoverage(evaluations);
  const thresholds={premiumQuality:Number(evalValue.releaseProfile?.premiumQualityThreshold??0),originalitySimilarity:Number(evalValue.releaseProfile?.originalitySimilarityThreshold??0)};
  const evaluatorLineage=sameGit(evalValue.git,git);if(!evaluatorLineage)failures.push("evaluator:lineage");
  const evaluatorPass=evalValue.schema==="website-design-compiler/design-quality-eval-receipt/v3"&&evalValue.overall==="PASS"&&evalValue.exactHeadBound===true&&evalValue.allEvidenceBound===true&&evalValue.allStructuralPass===true&&evalValue.allOriginalityPass===true&&evalValue.allMeasurementsPass===true;if(!evaluatorPass)failures.push("evaluator:state");
  const premiumPass=evalValue.premium?.state==="PASS"&&evaluations.length===12&&evaluations.every((entry:any)=>entry?.card?.schema==="website-design-compiler/design-quality-eval/v3"&&entry.card.overall==="PASS"&&entry.decision?.overall==="PREMIUM_PASS");if(!premiumPass)failures.push("evaluator:premium");
  const coveragePass=coverage.categories===6&&coverage.mobile===6&&coverage.desktop===6&&coverage.evaluations===12;if(!coveragePass)failures.push("evaluator:coverage");
  const calibrationPass=evalValue.calibration?.state==="PASS"&&evalValue.calibration?.exactObservationSetBound===true;if(!calibrationPass)failures.push("evaluator:calibration");
  const thresholdsPass=thresholds.premiumQuality>=78&&thresholds.originalitySimilarity>=.82;if(!thresholdsPass)failures.push("evaluator:thresholds");
  const bindingLineage=sameGit(bindingValue.git,git,true);if(!bindingLineage)failures.push("binding:lineage");
  const bindingPass=bindingValue.schema==="website-design-compiler/issue-36-evidence-binding/v2"&&bindingValue.overall==="PASS"&&bindingValue.inventory?.state==="PASS"&&bindingValue.inventory?.observed===12&&bindingValue.negativeControls?.state==="PASS";if(!bindingPass)failures.push("binding:state");
  const digestChain=bindingValue.evaluator?.path===evaluatorPath&&bindingValue.evaluator?.schema==="website-design-compiler/design-quality-eval-receipt/v3"&&bindingValue.evaluator?.sha256===evaluatorSha256;if(!digestChain)failures.push("binding:evaluator-substitute");
  const arenaLineage=sameGit(arenaValue.git,git);if(!arenaLineage)failures.push("arena:lineage");
  const arenaPass=arenaValue.overall==="PASS"&&arenaValue.v2Metrics?.designQuality?.state==="PASS"&&arenaValue.v2Metrics?.designQuality?.categoryCount===6&&arenaValue.v2Metrics?.designQuality?.mobileCount===6&&arenaValue.v2Metrics?.designQuality?.desktopCount===6&&arenaValue.evidence?.designQuality===evaluatorPath&&Array.isArray(arenaValue.metricEvidence?.designQualityPremium)&&arenaValue.metricEvidence.designQualityPremium.length===1&&arenaValue.metricEvidence.designQualityPremium[0]===evaluatorPath;if(!arenaPass)failures.push("arena:design-quality-premium");
  const gates={evaluator:evaluatorPass&&evaluatorLineage?"PASS":"FAIL",premium:premiumPass?"PASS":"FAIL",coverage:coveragePass?"PASS":"FAIL",calibration:calibrationPass?"PASS":"FAIL",binding:bindingPass&&bindingLineage?"PASS":"FAIL",arenaDesignQualityPremium:arenaPass&&arenaLineage?"PASS":"FAIL",digestChain:digestChain?"PASS":"FAIL",thresholds:thresholdsPass?"PASS":"FAIL"} satisfies Record<string,Gate>;
  return{overall:Object.values(gates).every((state)=>state==="PASS")&&failures.length===0?"PASS" as const:"FAIL" as const,gates,coverage,thresholds,failures:[...new Set(failures)].sort()};
}

async function read(root:string,path:string,schema?:string){try{const bytes=await readFile(join(root,path));const value=JSON.parse(bytes.toString("utf8"));if(schema)await validateAgainstSchema(value,schema);return{bytes,value,state:"PASS" as const};}catch{return{bytes:null,value:null,state:"FAIL" as const};}}
async function main(){
  const root=process.cwd();const git:GitSubject={ref:execFileSync("git",["symbolic-ref","--quiet","HEAD"],{encoding:"utf8"}).trim(),sha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),tree:execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim()};
  const evaluator=await read(root,evaluatorPath,"design-quality-eval-receipt-v3.schema.json");const binding=await read(root,bindingPath,"issue-36-evidence-binding.schema.json");const arena=await read(root,arenaPath);
  const digest=(bytes:Buffer|null)=>bytes?createHash("sha256").update(bytes).digest("hex"):null;const evaluatorDigest=digest(evaluator.bytes)??"ABSENT";
  const result=evaluateIssue36PremiumRelease(evaluator.value,binding.value,arena.value,git,evaluatorDigest);
  const evidence=(path:string,schema:string|undefined,subject:typeof evaluator,gate:"PASS"|"FAIL",tree=false)=>({path,sha256:digest(subject.bytes),...(schema?{schema}:{}),state:subject.state==="PASS"&&gate==="PASS"?"PASS":"FAIL",sameLineage:sameGit(subject.value?.git,git,tree)?"PASS":"FAIL"});
  const receipt={schema:"website-design-compiler/issue-36-premium-release/v1",overall:result.overall,git,evidence:{evaluator:evidence(evaluatorPath,"website-design-compiler/design-quality-eval-receipt/v3",evaluator,result.gates.evaluator),binding:evidence(bindingPath,"website-design-compiler/issue-36-evidence-binding/v2",binding,result.gates.binding,true),arena:evidence(arenaPath,undefined,arena,result.gates.arenaDesignQualityPremium)},gates:result.gates,coverage:result.coverage,thresholds:result.thresholds,failures:result.failures};
  await validateAgainstSchema(receipt,"issue-36-premium-release.schema.json");await mkdir(join(root,"artifacts","handoff"),{recursive:true});await writeFile(join(root,"artifacts","handoff","issue-36-premium-release.json"),`${JSON.stringify(receipt,null,2)}\n`);console.log(JSON.stringify({overall:receipt.overall,gates:receipt.gates,failures:receipt.failures}));if(receipt.overall!=="PASS")process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
