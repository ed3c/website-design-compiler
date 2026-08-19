import { execFileSync } from "node:child_process";

const gitShaPattern=/^[a-f0-9]{40}$/;
const exactRefPattern=/^refs\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;

function git(root:string,args:string[]):string{
  return execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
}

export function assertCleanTrackedGitSubject(root:string,expectedSha:string):{sha:string;tree:string}{
  if(!gitShaPattern.test(expectedSha))throw new Error("expected Git subject SHA is malformed");
  const head=git(root,["rev-parse","HEAD"]);
  if(head!==expectedSha)throw new Error(`checked-out Git subject ${head} does not match expected ${expectedSha}`);
  try{
    execFileSync("git",["diff","--quiet",expectedSha,"--"],{cwd:root,stdio:"ignore"});
  }catch(error){
    if(error&&typeof error==="object"&&"status" in error&&error.status===1)throw new Error("tracked worktree bytes differ from the exact Git subject");
    throw new Error("unable to verify tracked worktree bytes against the exact Git subject",{cause:error});
  }
  return{sha:head,tree:git(root,["rev-parse",`${expectedSha}^{tree}`])};
}

export function exactTrackedGitIdentity(root:string,expectedSha?:string,expectedRef?:string):{sha:string;tree:string;ref:string}{
  const sha=expectedSha??git(root,["rev-parse","HEAD"]);
  const subject=assertCleanTrackedGitSubject(root,sha);
  let ref=expectedRef;
  if(ref===undefined){
    try{ref=git(root,["symbolic-ref","--quiet","HEAD"]);}
    catch(error){
      if(error&&typeof error==="object"&&"status" in error&&error.status===1)ref=`refs/detached/${sha}`;
      else throw new Error("unable to resolve the tracked Git ref",{cause:error});
    }
  }
  if(!exactRefPattern.test(ref))throw new Error("tracked Git identity requires an exact refs/* ref");
  return{...subject,ref};
}
