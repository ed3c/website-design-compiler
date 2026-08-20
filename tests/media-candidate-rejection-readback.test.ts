import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildMediaCandidateRejectionReceipt } from "../src/media-candidate-rejection.js";
import { validateMediaCandidateRejectionReadback } from "../src/media-candidate-rejection-readback.js";

const git={sha:"a".repeat(40),tree:"b".repeat(40),ref:"refs/heads/rejection-readback"};

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),"wdc-rejection-readback-"));
  await mkdir(join(root,"fixtures/media"),{recursive:true});
  await mkdir(join(root,"artifacts/media-generator"),{recursive:true});
  const [policy,rights]=await Promise.all([
    readFile(join(process.cwd(),"fixtures/media/model-policy.json")),
    readFile(join(process.cwd(),"rights-production-evidence.json"))
  ]);
  await Promise.all([
    writeFile(join(root,"fixtures/media/model-policy.json"),policy),
    writeFile(join(root,"rights-production-evidence.json"),rights)
  ]);
  const trustedRightsEvidenceSha256=createHash("sha256").update(rights).digest("hex");
  const receipt=await buildMediaCandidateRejectionReceipt(root,git,new Date("2026-08-19T00:01:00.000Z"),trustedRightsEvidenceSha256,git.tree);
  const bytes=Buffer.from(`${JSON.stringify(receipt,null,2)}\n`);
  const path="media-candidate-rejection.json";
  await writeFile(join(root,"artifacts/media-generator",path),bytes);
  return{
    root,
    trustedRightsEvidenceSha256,
    binding:{path,schema:receipt.schema,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.byteLength,sourceAdmissionSha256:trustedRightsEvidenceSha256,trustedGitTree:git.tree}
  };
}

test("candidate rejection readback reconstructs the formal-route receipt from current governed inputs",async()=>{
  const value=await fixture();
  try{
    assert.deepEqual(await validateMediaCandidateRejectionReadback({
      root:value.root,binding:value.binding,expectedGit:git,trustedRightsEvidenceSha256:value.trustedRightsEvidenceSha256,trustedGitTree:git.tree
    }),[]);
  }finally{await rm(value.root,{recursive:true,force:true});}
});

test("candidate rejection readback fails for missing, mutated, or upstream-drifted evidence",async()=>{
  const value=await fixture();
  try{
    const path=join(value.root,"artifacts/media-generator/media-candidate-rejection.json");
    await writeFile(path,"{}\n");
    let errors=await validateMediaCandidateRejectionReadback({root:value.root,binding:value.binding,expectedGit:git,trustedRightsEvidenceSha256:value.trustedRightsEvidenceSha256,trustedGitTree:git.tree});
    assert.match(errors.join("; "),/SHA-256 mismatch|byte count mismatch/);

    await rm(path);
    errors=await validateMediaCandidateRejectionReadback({root:value.root,binding:value.binding,expectedGit:git,trustedRightsEvidenceSha256:value.trustedRightsEvidenceSha256,trustedGitTree:git.tree});
    assert.match(errors.join("; "),/missing or unreadable/);

    const fresh=await fixture();
    try{
      const policyPath=join(fresh.root,"fixtures/media/model-policy.json");
      const policy=JSON.parse(await readFile(policyPath,"utf8")) as {entries:Array<{reason?:string}>};
      policy.entries.find((entry)=>entry.reason)!.reason="drifted rejection rationale";
      await writeFile(policyPath,`${JSON.stringify(policy,null,2)}\n`);
      errors=await validateMediaCandidateRejectionReadback({root:fresh.root,binding:fresh.binding,expectedGit:git,trustedRightsEvidenceSha256:fresh.trustedRightsEvidenceSha256,trustedGitTree:git.tree});
      assert.match(errors.join("; "),/does not match current policy and rights evidence/);
    }finally{await rm(fresh.root,{recursive:true,force:true});}
  }finally{await rm(value.root,{recursive:true,force:true});}
});

test("candidate rejection readback rejects symlinks and absent external trust",async()=>{
  const value=await fixture();
  const outside=await mkdtemp(join(tmpdir(),"wdc-rejection-outside-"));
  try{
    const path=join(value.root,"artifacts/media-generator/media-candidate-rejection.json");
    const outsidePath=join(outside,"receipt.json");
    await writeFile(outsidePath,await readFile(path));
    await rm(path);
    await symlink(outsidePath,path);
    let errors=await validateMediaCandidateRejectionReadback({root:value.root,binding:value.binding,expectedGit:git,trustedRightsEvidenceSha256:value.trustedRightsEvidenceSha256,trustedGitTree:git.tree});
    assert.match(errors.join("; "),/symbolic link|outside/);
    errors=await validateMediaCandidateRejectionReadback({root:value.root,binding:value.binding,expectedGit:git});
    assert.match(errors.join("; "),/externally trusted.*absent/i);
  }finally{
    await rm(value.root,{recursive:true,force:true});
    await rm(outside,{recursive:true,force:true});
  }
});

test("candidate rejection readback binds the protected tree to the release subject",async()=>{
  const value=await fixture();
  try{
    const errors=await validateMediaCandidateRejectionReadback({
      root:value.root,
      binding:value.binding,
      expectedGit:{...git,tree:"c".repeat(40)},
      trustedRightsEvidenceSha256:value.trustedRightsEvidenceSha256,
      trustedGitTree:git.tree
    });
    assert.match(errors.join("; "),/release Git tree does not match the externally trusted Git tree/);
  }finally{await rm(value.root,{recursive:true,force:true});}
});

test("candidate rejection readback rejects a symlinked artifact directory",async()=>{
  const value=await fixture();
  const outside=await mkdtemp(join(tmpdir(),"wdc-rejection-directory-outside-"));
  try{
    const directory=join(value.root,"artifacts/media-generator");
    const outsideDirectory=join(outside,"media-generator");
    await rename(directory,outsideDirectory);
    await symlink(outsideDirectory,directory,"dir");
    const errors=await validateMediaCandidateRejectionReadback({
      root:value.root,binding:value.binding,expectedGit:git,trustedRightsEvidenceSha256:value.trustedRightsEvidenceSha256,trustedGitTree:git.tree
    });
    assert.match(errors.join("; "),/directory resolves through a symbolic link|outside the workspace/);
  }finally{
    await rm(value.root,{recursive:true,force:true});
    await rm(outside,{recursive:true,force:true});
  }
});
