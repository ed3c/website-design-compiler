import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readCapabilityEvidence, verifyCoreReleaseEvidence } from "../src/release-evidence.js";
import { CAPABILITIES, CAPABILITY_RECEIPT_CONTRACTS, evaluateReleasePolicy, type Capability, type CapabilityEvidence, type ReleasePolicy, type ReleaseProfile } from "../src/release-policy-v2.js";
import { assertCleanTrackedGitSubject } from "../src/tracked-git-subject.js";

const root=process.cwd();
const git={sha:process.env.GITHUB_SHA??"",ref:process.env.GITHUB_REF??"UNBOUND",event:process.env.GITHUB_EVENT_NAME??"UNBOUND"};
const gitTree=assertCleanTrackedGitSubject(root,git.sha).tree;
const policy=JSON.parse(await readFile(join(root,"fixtures/v2/release-policy.json"),"utf8")) as ReleasePolicy;
const premiumProfileBytes=await readFile(join(root,policy.premiumQuality.profilePath));
const premiumProfile=JSON.parse(premiumProfileBytes.toString("utf8")) as {schema:string;id:string;premiumQualityThreshold:number;originalitySimilarityThreshold:number;requiredViewports:string[];requireExactEvidenceBinding:boolean};
const profile=(process.env.WDC_RELEASE_PROFILE??"CORE") as ReleaseProfile;
if(!(profile in policy.profiles))throw new Error(`unknown WDC_RELEASE_PROFILE ${profile}`);

const evidence={} as Record<Capability,CapabilityEvidence>;
const evidenceValidationErrors:Partial<Record<Capability,string[]>>={};
for(const capability of CAPABILITIES){
  const observed=await readCapabilityEvidence(root,capability,{sha:git.sha,ref:git.ref,tree:gitTree});
  if(capability!=="core"){evidence[capability]=observed;continue;}
  const verified=await verifyCoreReleaseEvidence(root,{sha:git.sha,ref:git.ref});
  if(verified.errors.length>0)evidenceValidationErrors.core=verified.errors;
  evidence.core={...observed,state:verified.state};
}
const evaluation=evaluateReleasePolicy(policy,profile,evidence,git);
const receipt={...evaluation,premiumQualityProfile:{path:policy.premiumQuality.profilePath,sha256:createHash("sha256").update(premiumProfileBytes).digest("hex"),...premiumProfile},evidenceContracts:CAPABILITY_RECEIPT_CONTRACTS,evidenceValidationErrors,unresolvedBoundaries:Object.entries(evaluation.capabilities).filter(([,value])=>value.required&&(value.state!=="PASS"||value.binding!=="BOUND")).map(([capability,value])=>({capability,state:value.state,binding:value.binding}))};
const outputDirectory=join(root,"artifacts/release-v2");
await mkdir(outputDirectory,{recursive:true});
await writeFile(join(outputDirectory,"release-policy-v2-receipt.json"),`${JSON.stringify(receipt,null,2)}\n`,"utf8");
console.log(JSON.stringify({profile,overall:receipt.overall,canonicalMain:receipt.canonicalMain,failures:receipt.failures}));
if(receipt.overall!=="PASS")process.exitCode=1;
