export const CAPABILITIES=["core","liveReference","webgpu","repositoryRights","productionProvider","premiumQuality"] as const;
export type Capability=(typeof CAPABILITIES)[number];
export type ReleaseProfile="CORE"|"NETWORKED_REFERENCE"|"ADVANCED_GPU"|"COMMERCIAL_PRODUCTION"|"FULL_V2";
export type CapabilityState="PASS"|"FAIL"|"ABSENT"|"NOT_IMPLEMENTED"|"NOT_EXERCISED"|"SKIPPED_BY_POLICY";
export interface CapabilityEvidence{state:CapabilityState;gitSha:string|null;identity:string|null;}
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
  capabilities:Record<Capability,{required:boolean;state:CapabilityState|"NOT_REQUIRED";binding:"BOUND"|"MISMATCH"|"ABSENT"|"NOT_REQUIRED";identity:string|null}>;
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
  if(policy.premiumQuality.profilePath!=="fixtures/v2/release-profiles/premium.json")errors.push("premium quality must point to the governed profile SSOT");
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
      capabilities[capability]={required:false,state:"NOT_REQUIRED",binding:"NOT_REQUIRED",identity:evidence[capability].identity};
      continue;
    }
    const subject=evidence[capability];
    const binding=subject.gitSha===null?"ABSENT":subject.gitSha===git.sha?"BOUND":"MISMATCH";
    capabilities[capability]={required:true,state:subject.state,binding,identity:subject.identity};
    if(subject.state!=="PASS")failures.push(`${capability}:${subject.state}`);
    if(binding!=="BOUND")failures.push(`${capability}:git-${binding}`);
    if(!subject.identity)failures.push(`${capability}:identity-ABSENT`);
  }
  const canonicalMain=git.ref==="refs/heads/main"&&git.event==="push"?"PASS":"NOT_EXERCISED";
  if(canonicalMain!=="PASS")failures.push(`canonical-main:${canonicalMain}`);
  return{schema:"website-design-compiler/release-policy-evaluation/v2",profile,overall:failures.length===0?"PASS":"FAIL",canonicalMain,git,capabilities,failures,premiumQuality:policy.premiumQuality};
}
