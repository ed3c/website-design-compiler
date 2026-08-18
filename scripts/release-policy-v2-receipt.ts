import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { evaluateReleasePolicy, type Capability, type CapabilityEvidence, type CapabilityState, type ReleasePolicy, type ReleaseProfile } from "../src/release-policy-v2.js";

const root=process.cwd();
const policy=JSON.parse(await readFile(join(root,"fixtures/v2/release-policy.json"),"utf8")) as ReleasePolicy;
const premiumProfileBytes=await readFile(join(root,policy.premiumQuality.profilePath));
const premiumProfile=JSON.parse(premiumProfileBytes.toString("utf8")) as {schema:string;id:string;premiumQualityThreshold:number;originalitySimilarityThreshold:number;requiredViewports:string[];requireExactEvidenceBinding:boolean};
const profile=(process.env.WDC_RELEASE_PROFILE??"CORE") as ReleaseProfile;
if(!(profile in policy.profiles))throw new Error(`unknown WDC_RELEASE_PROFILE ${profile}`);
const git={sha:process.env.GITHUB_SHA??"",ref:process.env.GITHUB_REF??"UNBOUND",event:process.env.GITHUB_EVENT_NAME??"UNBOUND"};

const paths:Record<Capability,string>={
  core:"artifacts/release/release-gate-receipt.json",
  liveReference:"artifacts/live-reference/live-reference-receipt.json",
  webgpu:"artifacts/graphics-3d/webgpu-receipt.json",
  repositoryRights:"artifacts/rights-clearance/repository-rights-clearance.json",
  productionProvider:"artifacts/media-generator/production-provider-status.json",
  premiumQuality:"artifacts/v2/design-quality/design-quality-eval-receipt.json"
};
function evidenceState(value:unknown):CapabilityState{return value==="PASS"||value==="FAIL"||value==="ABSENT"||value==="NOT_IMPLEMENTED"||value==="NOT_EXERCISED"||value==="SKIPPED_BY_POLICY"?value:"FAIL";}
async function readEvidence(path:string):Promise<CapabilityEvidence>{
  try{
    const receipt=JSON.parse(await readFile(join(root,path),"utf8")) as {schema?:unknown;overall?:unknown;git?:{sha?:unknown}};
    return{state:evidenceState(receipt.overall),gitSha:typeof receipt.git?.sha==="string"?receipt.git.sha:null,identity:typeof receipt.schema==="string"?receipt.schema:null};
  }catch(error){
    if(error instanceof Error&&"code" in error&&error.code==="ENOENT")return{state:"ABSENT",gitSha:null,identity:null};
    throw error;
  }
}
const evidence={} as Record<Capability,CapabilityEvidence>;
for(const [capability,path] of Object.entries(paths) as Array<[Capability,string]>)evidence[capability]=await readEvidence(path);
const evaluation=evaluateReleasePolicy(policy,profile,evidence,git);
const receipt={...evaluation,premiumQualityProfile:{path:policy.premiumQuality.profilePath,sha256:createHash("sha256").update(premiumProfileBytes).digest("hex"),...premiumProfile},evidencePaths:paths,unresolvedBoundaries:Object.entries(evaluation.capabilities).filter(([,value])=>value.required&&(value.state!=="PASS"||value.binding!=="BOUND")).map(([capability,value])=>({capability,state:value.state,binding:value.binding}))};
const outputDirectory=join(root,"artifacts/release-v2");
await mkdir(outputDirectory,{recursive:true});
await writeFile(join(outputDirectory,"release-policy-v2-receipt.json"),`${JSON.stringify(receipt,null,2)}\n`,"utf8");
console.log(JSON.stringify({profile,overall:receipt.overall,canonicalMain:receipt.canonicalMain,failures:receipt.failures}));
if(receipt.overall!=="PASS")process.exitCode=1;
