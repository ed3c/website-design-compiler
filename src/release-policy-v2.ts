export const CAPABILITIES=["core","liveReference","webgpu","repositoryRights","productionProvider","premiumQuality"] as const;
export type Capability=(typeof CAPABILITIES)[number];
export type ReleaseProfile="CORE"|"NETWORKED_REFERENCE"|"ADVANCED_GPU"|"COMMERCIAL_PRODUCTION"|"FULL_V2";
export type CapabilityState="PASS"|"FAIL"|"ABSENT"|"NOT_IMPLEMENTED"|"NOT_EXERCISED"|"SKIPPED_BY_POLICY";
export interface CapabilityReceiptContract{path:string;schemaFile:string;identity:string;}
export const CAPABILITY_RECEIPT_CONTRACTS:Record<Capability,CapabilityReceiptContract>={
  core:{path:"artifacts/release/release-gate-receipt.json",schemaFile:"release-gate-receipt-v2.schema.json",identity:"website-design-compiler/release-gate-receipt/v2"},
  liveReference:{path:"artifacts/live-reference/live-reference-receipt.json",schemaFile:"live-reference-receipt.schema.json",identity:"website-design-compiler/live-reference-receipt/v2"},
  webgpu:{path:"artifacts/graphics-3d/webgpu-receipt.json",schemaFile:"webgpu-runtime-receipt.schema.json",identity:"website-design-compiler/webgpu-runtime-receipt/v1"},
  repositoryRights:{path:"artifacts/rights-clearance/repository-rights-clearance.json",schemaFile:"repository-rights-clearance.schema.json",identity:"website-design-compiler/repository-rights-clearance/v2"},
  productionProvider:{path:"artifacts/media-generator/production-provider-status.json",schemaFile:"production-provider-status.schema.json",identity:"website-design-compiler/production-provider-status/v3"},
  premiumQuality:{path:"artifacts/v3/design-quality/design-quality-eval-receipt.json",schemaFile:"design-quality-eval-receipt-v3.schema.json",identity:"website-design-compiler/design-quality-eval-receipt/v3"}
};
export const CAPABILITY_RECEIPT_SCHEMAS: Record<Capability, string> = Object.fromEntries(
  Object.entries(CAPABILITY_RECEIPT_CONTRACTS).map(([capability, contract]) => [capability, contract.identity])
) as Record<Capability, string>;
export interface CapabilityEvidence{state:CapabilityState;gitSha:string|null;identity:string|null;artifactPath:string;artifactSha256:string|null;}
export interface ReleasePolicy{
  schema:"website-design-compiler/release-policy/v2";
  profiles:Record<ReleaseProfile,{required:Capability[]}>;
  premiumQuality:{profilePath:string};
}
export interface ReleasePolicyEvaluation{
  schema:"website-design-compiler/release-policy-evaluation/v2";
  profile:ReleaseProfile;
  overall:"PASS"|"FAIL";
  canonicalMain:"PASS"|"NOT_EXERCISED";
  git:{sha:string;ref:string;event:string};
  capabilities:Record<Capability,{required:boolean;state:CapabilityState|"NOT_REQUIRED";binding:"BOUND"|"MISMATCH"|"ABSENT"|"NOT_REQUIRED";identity:string|null;artifactPath:string;artifactSha256:string|null}>;
  failures:string[];
  premiumQuality:ReleasePolicy["premiumQuality"];
}

const SHA=/^[a-f0-9]{40}$/;
export function validateReleasePolicy(policy:ReleasePolicy):string[]{
  const errors:string[]=[];
  if(policy.schema!=="website-design-compiler/release-policy/v2")errors.push("release policy schema is invalid");
  const expectedProfiles:ReleaseProfile[]=["CORE","NETWORKED_REFERENCE","ADVANCED_GPU","COMMERCIAL_PRODUCTION","FULL_V2"];
  for(const profile of expectedProfiles){
    const required=policy.profiles[profile]?.required;
    if(!Array.isArray(required)||required.length===0)errors.push(`${profile}: required capabilities are missing`);
    else{
      if(!required.includes("core"))errors.push(`${profile}: core capability is required`);
      if(new Set(required).size!==required.length)errors.push(`${profile}: duplicate required capability`);
      for(const capability of required)if(!CAPABILITIES.includes(capability))errors.push(`${profile}: unknown capability ${capability}`);
    }
  }
  if(!policy.profiles.COMMERCIAL_PRODUCTION.required.includes("repositoryRights")||!policy.profiles.COMMERCIAL_PRODUCTION.required.includes("productionProvider"))errors.push("COMMERCIAL_PRODUCTION requires repository rights and production provider evidence");
  if(!CAPABILITIES.every((capability)=>policy.profiles.FULL_V2.required.includes(capability)))errors.push("FULL_V2 must require every capability");
  if(policy.premiumQuality.profilePath!=="fixtures/v3/release-profiles/premium.json")errors.push("premium quality must point to the governed profile SSOT");
  return errors;
}

export function evaluateReleasePolicy(policy:ReleasePolicy,profile:ReleaseProfile,evidence:Record<Capability,CapabilityEvidence>,git:{sha:string;ref:string;event:string}):ReleasePolicyEvaluation{
  const policyErrors=validateReleasePolicy(policy);
  if(policyErrors.length>0)throw new Error(`invalid release policy: ${policyErrors.join("; ")}`);
  if(!SHA.test(git.sha))throw new Error("release policy requires an exact 40-character git SHA");
  const required=new Set(policy.profiles[profile].required);
  const failures:string[]=[];
  const capabilities={} as ReleasePolicyEvaluation["capabilities"];
  for(const capability of CAPABILITIES){
    if(!required.has(capability)){
      capabilities[capability]={required:false,state:"NOT_REQUIRED",binding:"NOT_REQUIRED",identity:evidence[capability].identity,artifactPath:evidence[capability].artifactPath,artifactSha256:evidence[capability].artifactSha256};
      continue;
    }
    const subject=evidence[capability];
    const contract=CAPABILITY_RECEIPT_CONTRACTS[capability];
    const binding=subject.gitSha===null?"ABSENT":subject.gitSha===git.sha?"BOUND":"MISMATCH";
    capabilities[capability]={required:true,state:subject.state,binding,identity:subject.identity,artifactPath:subject.artifactPath,artifactSha256:subject.artifactSha256};
    if(subject.state!=="PASS")failures.push(`${capability}:${subject.state}`);
    if(binding!=="BOUND")failures.push(`${capability}:git-${binding}`);
    if(subject.identity!==contract.identity)failures.push(`${capability}:identity-${subject.identity===null?"ABSENT":"MISMATCH"}`);
    if(subject.artifactPath!==contract.path)failures.push(`${capability}:path-MISMATCH`);
    if(subject.artifactSha256===null)failures.push(`${capability}:digest-ABSENT`);
    else if(!/^[a-f0-9]{64}$/.test(subject.artifactSha256))failures.push(`${capability}:digest-MALFORMED`);
  }
  const canonicalMain=git.ref==="refs/heads/main"&&git.event==="push"?"PASS":"NOT_EXERCISED";
  if(canonicalMain!=="PASS")failures.push(`canonical-main:${canonicalMain}`);
  return{schema:"website-design-compiler/release-policy-evaluation/v2",profile,overall:failures.length===0?"PASS":"FAIL",canonicalMain,git,capabilities,failures,premiumQuality:policy.premiumQuality};
}
