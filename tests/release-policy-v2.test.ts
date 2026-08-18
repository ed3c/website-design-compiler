import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleasePolicy, validateReleasePolicy, type CapabilityEvidence, type ReleasePolicy } from "../src/release-policy-v2.js";
import { validateAgainstSchema } from "../src/validate.js";

const policy:ReleasePolicy={
  schema:"website-design-compiler/release-policy/v2",
  profiles:{
    CORE:{required:["core"]},
    NETWORKED_REFERENCE:{required:["core","liveReference"]},
    ADVANCED_GPU:{required:["core","webgpu"]},
    COMMERCIAL_PRODUCTION:{required:["core","repositoryRights","productionProvider"]},
    FULL_V2:{required:["core","liveReference","webgpu","repositoryRights","productionProvider","premiumQuality"]}
  },
  premiumQuality:{profilePath:"fixtures/v2/release-profiles/premium.json"}
};
const sha="a".repeat(40);
const pass=(identity:string):CapabilityEvidence=>({state:"PASS",gitSha:sha,identity});
const all={core:pass("release-gate/v2"),liveReference:pass("live-reference/v2"),webgpu:pass("webgpu/v2"),repositoryRights:pass("rights/v2"),productionProvider:pass("provider/v2"),premiumQuality:pass("quality/v2")};

test("release policy validates versioned profiles and points to the premium threshold SSOT",async()=>{
  assert.deepEqual(validateReleasePolicy(policy),[]);
  await validateAgainstSchema(policy,"release-policy-v2.schema.json");
});

test("CORE visibly marks every non-required capability NOT_REQUIRED",()=>{
  const result=evaluateReleasePolicy(policy,"CORE",all,{sha,ref:"refs/heads/main",event:"push"});
  assert.equal(result.overall,"PASS");
  assert.equal(result.capabilities.core.state,"PASS");
  assert.equal(result.capabilities.liveReference.state,"NOT_REQUIRED");
  assert.equal(result.capabilities.premiumQuality.state,"NOT_REQUIRED");
});

test("missing or failing required capability cannot pass",()=>{
  const missing=evaluateReleasePolicy(policy,"NETWORKED_REFERENCE",{...all,liveReference:{state:"ABSENT",gitSha:null,identity:null}},{sha,ref:"refs/heads/main",event:"push"});
  assert.equal(missing.overall,"FAIL");
  assert.equal(missing.capabilities.liveReference.state,"ABSENT");
  const failed=evaluateReleasePolicy(policy,"ADVANCED_GPU",{...all,webgpu:{state:"FAIL",gitSha:sha,identity:"webgpu/v2"}},{sha,ref:"refs/heads/main",event:"push"});
  assert.equal(failed.overall,"FAIL");
});

test("required receipt from a different SHA fails exact binding",()=>{
  const result=evaluateReleasePolicy(policy,"COMMERCIAL_PRODUCTION",{...all,productionProvider:{...all.productionProvider,gitSha:"b".repeat(40)}},{sha,ref:"refs/heads/main",event:"push"});
  assert.equal(result.overall,"FAIL");
  assert.equal(result.capabilities.productionProvider.binding,"MISMATCH");
});

test("FULL_V2 requires every v2 capability and canonical main identity",()=>{
  assert.equal(evaluateReleasePolicy(policy,"FULL_V2",all,{sha,ref:"refs/heads/main",event:"push"}).overall,"PASS");
  const pullRequest=evaluateReleasePolicy(policy,"FULL_V2",all,{sha,ref:"refs/pull/42/merge",event:"pull_request"});
  assert.equal(pullRequest.overall,"FAIL");
  assert.equal(pullRequest.canonicalMain,"NOT_EXERCISED");
});
