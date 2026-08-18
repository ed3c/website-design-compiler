import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { readCapabilityEvidence } from "../src/release-evidence.js";
import { CAPABILITIES, CAPABILITY_RECEIPT_CONTRACTS, evaluateReleasePolicy, validateReleasePolicy, type Capability, type CapabilityEvidence, type ReleasePolicy } from "../src/release-policy-v2.js";
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
const pass=(capability:Capability):CapabilityEvidence=>({state:"PASS",gitSha:sha,identity:CAPABILITY_RECEIPT_CONTRACTS[capability].identity,artifactPath:CAPABILITY_RECEIPT_CONTRACTS[capability].path,artifactSha256:"b".repeat(64)});
const all=Object.fromEntries(CAPABILITIES.map((capability)=>[capability,pass(capability)])) as Record<Capability,CapabilityEvidence>;

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
  const missing=evaluateReleasePolicy(policy,"NETWORKED_REFERENCE",{...all,liveReference:{...all.liveReference,state:"ABSENT",gitSha:null,identity:null,artifactSha256:null}},{sha,ref:"refs/heads/main",event:"push"});
  assert.equal(missing.overall,"FAIL");
  assert.equal(missing.capabilities.liveReference.state,"ABSENT");
  const failed=evaluateReleasePolicy(policy,"ADVANCED_GPU",{...all,webgpu:{...all.webgpu,state:"FAIL"}},{sha,ref:"refs/heads/main",event:"push"});
  assert.equal(failed.overall,"FAIL");
});

test("required receipt from a different SHA fails exact binding",()=>{
  const result=evaluateReleasePolicy(policy,"COMMERCIAL_PRODUCTION",{...all,productionProvider:{...all.productionProvider,gitSha:"b".repeat(40)}},{sha,ref:"refs/heads/main",event:"push"});
  assert.equal(result.overall,"FAIL");
  assert.equal(result.capabilities.productionProvider.binding,"MISMATCH");
});

test("required receipt cannot substitute path identity or omit its artifact digest",()=>{
  const substituted=evaluateReleasePolicy(policy,"NETWORKED_REFERENCE",{...all,liveReference:{...all.liveReference,artifactPath:"artifacts/attacker/receipt.json",identity:"attacker/schema",artifactSha256:null}},{sha,ref:"refs/heads/main",event:"push"});
  assert.equal(substituted.overall,"FAIL");
  assert.ok(substituted.failures.includes("liveReference:path-MISMATCH"));
  assert.ok(substituted.failures.includes("liveReference:identity-MISMATCH"));
  assert.ok(substituted.failures.includes("liveReference:digest-ABSENT"));
});

test("FULL_V2 requires every v2 capability and canonical main identity",()=>{
  assert.equal(evaluateReleasePolicy(policy,"FULL_V2",all,{sha,ref:"refs/heads/main",event:"push"}).overall,"PASS");
  const pullRequest=evaluateReleasePolicy(policy,"FULL_V2",all,{sha,ref:"refs/pull/42/merge",event:"pull_request"});
  assert.equal(pullRequest.overall,"FAIL");
  assert.equal(pullRequest.canonicalMain,"NOT_EXERCISED");
});

test("capability evidence reader validates fixed schema and rejects malformed JSON",async()=>{
  const root=await mkdtemp(join(tmpdir(),"wdc-release-evidence-"));
  const contract=CAPABILITY_RECEIPT_CONTRACTS.core;
  await mkdir(join(root,"schemas"),{recursive:true});
  await writeFile(join(root,"schemas",contract.schemaFile),await readFile(join(process.cwd(),"schemas",contract.schemaFile)));
  const artifactPath=join(root,contract.path);
  await mkdir(dirname(artifactPath),{recursive:true});
  const receipt={schema:contract.identity,overall:"PASS",git:{sha,ref:"refs/heads/main",event:"push",changedFiles:[]},workflow:{},environment:{},bindings:"ABSENT",gates:{core:"PASS"},evidence:{core:"artifact.json"},unresolvedRisks:[]};
  await writeFile(artifactPath,`${JSON.stringify(receipt)}\n`,"utf8");
  const evidence=await readCapabilityEvidence(root,"core");
  assert.equal(evidence.identity,contract.identity);
  assert.equal(evidence.artifactPath,contract.path);
  assert.match(evidence.artifactSha256??"",/^[a-f0-9]{64}$/);
  await writeFile(artifactPath,"{malformed", "utf8");
  await assert.rejects(readCapabilityEvidence(root,"core"),/malformed JSON/);
});
