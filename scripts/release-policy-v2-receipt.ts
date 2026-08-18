import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { RELEASE_CAPABILITY_SPECS, readBoundReleaseEvidence, verifyCoreReleaseEvidence } from "../src/release-evidence.js";
import { CAPABILITY_RECEIPT_SCHEMAS, evaluateReleasePolicy, type Capability, type CapabilityEvidence, type CapabilityState, type ReleasePolicy, type ReleaseProfile } from "../src/release-policy-v2.js";

const root=process.cwd();
const policy=JSON.parse(await readFile(join(root,"fixtures/v2/release-policy.json"),"utf8")) as ReleasePolicy;
const premiumProfileBytes=await readFile(join(root,policy.premiumQuality.profilePath));
const premiumProfile=JSON.parse(premiumProfileBytes.toString("utf8")) as {schema:string;id:string;premiumQualityThreshold:number;originalitySimilarityThreshold:number;requiredViewports:string[];requireExactEvidenceBinding:boolean};
const profile=(process.env.WDC_RELEASE_PROFILE??"CORE") as ReleaseProfile;
if(!(profile in policy.profiles))throw new Error(`unknown WDC_RELEASE_PROFILE ${profile}`);
const git={sha:process.env.GITHUB_SHA??"",ref:process.env.GITHUB_REF??"UNBOUND",event:process.env.GITHUB_EVENT_NAME??"UNBOUND"};

const paths:Record<Capability,string>={
  core:"artifacts/release/release-gate-receipt.json",
  liveReference:RELEASE_CAPABILITY_SPECS.liveReference.path,
  webgpu:RELEASE_CAPABILITY_SPECS.webgpu.path,
  repositoryRights:RELEASE_CAPABILITY_SPECS.repositoryRights.path,
  productionProvider:RELEASE_CAPABILITY_SPECS.productionProvider.path,
  premiumQuality:RELEASE_CAPABILITY_SPECS.premiumQuality.path
};
const evidenceValidationErrors:Partial<Record<Capability,string[]>>={};
async function readEvidence(capability:Capability,path:string):Promise<CapabilityEvidence>{
  if(capability==="core"){
    const verified=await verifyCoreReleaseEvidence(root,{sha:git.sha,ref:git.ref});
    if(verified.errors.length>0)evidenceValidationErrors.core=verified.errors;
    return{state:verified.state,gitSha:verified.git?.sha??null,identity:verified.schema===CAPABILITY_RECEIPT_SCHEMAS.core?CAPABILITY_RECEIPT_SCHEMAS.core:null};
  }
  const spec=RELEASE_CAPABILITY_SPECS[capability as Exclude<Capability,"core">];
  const verified=await readBoundReleaseEvidence(root,path,spec.schema,{sha:git.sha,ref:git.ref});
  if(verified.errors.length>0)evidenceValidationErrors[capability]=verified.errors;
  const absent=verified.sha256===null&&verified.binding==="ABSENT";
  return{state:absent?"ABSENT":verified.state as CapabilityState,gitSha:verified.git?.sha??null,identity:verified.schema===CAPABILITY_RECEIPT_SCHEMAS[capability]?CAPABILITY_RECEIPT_SCHEMAS[capability]:null};
}
const evidence={} as Record<Capability,CapabilityEvidence>;
for(const [capability,path] of Object.entries(paths) as Array<[Capability,string]>)evidence[capability]=await readEvidence(capability,path);
const evaluation=evaluateReleasePolicy(policy,profile,evidence,git);
const receipt={...evaluation,premiumQualityProfile:{path:policy.premiumQuality.profilePath,sha256:createHash("sha256").update(premiumProfileBytes).digest("hex"),...premiumProfile},evidencePaths:paths,evidenceValidationErrors,unresolvedBoundaries:Object.entries(evaluation.capabilities).filter(([,value])=>value.required&&(value.state!=="PASS"||value.binding!=="BOUND")).map(([capability,value])=>({capability,state:value.state,binding:value.binding}))};
const outputDirectory=join(root,"artifacts/release-v2");
await mkdir(outputDirectory,{recursive:true});
await writeFile(join(outputDirectory,"release-policy-v2-receipt.json"),`${JSON.stringify(receipt,null,2)}\n`,"utf8");
console.log(JSON.stringify({profile,overall:receipt.overall,canonicalMain:receipt.canonicalMain,failures:receipt.failures}));
if(receipt.overall!=="PASS")process.exitCode=1;
