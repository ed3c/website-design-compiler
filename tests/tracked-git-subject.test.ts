import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertCleanTrackedGitSubject, exactTrackedGitIdentity } from "../src/tracked-git-subject.js";

function git(root:string,args:string[]):string{
  return execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
}

test("exact Git subject rejects staged and unstaged tracked drift",async()=>{
  const root=await mkdtemp(join(tmpdir(),"wdc-tracked-subject-"));
  try{
    git(root,["init","-q"]);
    git(root,["config","user.name","WDC Test"]);
    git(root,["config","user.email","wdc-test@example.invalid"]);
    const path=join(root,"policy.json");
    await writeFile(path,"{\"state\":\"DENY\"}\n");
    git(root,["add","policy.json"]);
    git(root,["commit","-q","-m","fixture"]);
    const sha=git(root,["rev-parse","HEAD"]);
    const tree=git(root,["rev-parse","HEAD^{tree}"]);
    assert.deepEqual(assertCleanTrackedGitSubject(root,sha),{sha,tree});

    await writeFile(path,"{\"state\":\"REVIEW_REQUIRED\"}\n");
    assert.throws(()=>assertCleanTrackedGitSubject(root,sha),/tracked worktree bytes differ/);
    git(root,["add","policy.json"]);
    assert.throws(()=>assertCleanTrackedGitSubject(root,sha),/tracked worktree bytes differ/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("exact Git subject rejects a different checked-out commit",async()=>{
  const root=await mkdtemp(join(tmpdir(),"wdc-tracked-subject-sha-"));
  try{
    git(root,["init","-q"]);
    git(root,["config","user.name","WDC Test"]);
    git(root,["config","user.email","wdc-test@example.invalid"]);
    await writeFile(join(root,"subject.txt"),"one\n");
    git(root,["add","subject.txt"]);
    git(root,["commit","-q","-m","one"]);
    const first=git(root,["rev-parse","HEAD"]);
    await writeFile(join(root,"subject.txt"),"two\n");
    git(root,["commit","-q","-am","two"]);
    assert.throws(()=>assertCleanTrackedGitSubject(root,first),/does not match expected/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("exact tracked Git identity preserves the CI ref and rejects an empty branch ref",async()=>{
  const root=await mkdtemp(join(tmpdir(),"wdc-tracked-identity-"));
  try{
    git(root,["init","-q"]);
    git(root,["config","user.name","WDC Test"]);
    git(root,["config","user.email","wdc-test@example.invalid"]);
    await writeFile(join(root,"subject.txt"),"subject\n");
    git(root,["add","subject.txt"]);
    git(root,["commit","-q","-m","subject"]);
    const sha=git(root,["rev-parse","HEAD"]);
    const tree=git(root,["rev-parse","HEAD^{tree}"]);
    assert.deepEqual(exactTrackedGitIdentity(root,sha,"refs/pull/44/merge"),{sha,tree,ref:"refs/pull/44/merge"});
    assert.throws(()=>exactTrackedGitIdentity(root,sha,""),/exact refs/);
    assert.throws(()=>exactTrackedGitIdentity(root,sha,"refs/heads/"),/exact refs/);
    git(root,["checkout","--detach","-q"]);
    assert.deepEqual(exactTrackedGitIdentity(root,sha),{sha,tree,ref:`refs/detached/${sha}`});
  }finally{await rm(root,{recursive:true,force:true});}
});
