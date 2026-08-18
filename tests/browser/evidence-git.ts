import { execFileSync } from "node:child_process";

export interface ExactGitIdentity {
  sha:string;
  tree:string;
  ref:string;
}

const OBJECT_ID=/^[a-f0-9]{40}$/;
const EXACT_REF=/^refs\/[A-Za-z0-9._/-]+$/;

function git(args:string[]):string{return execFileSync("git",args,{cwd:process.cwd(),encoding:"utf8"}).trim();}

export function exactGitIdentity():ExactGitIdentity{
  const sha=process.env.GITHUB_SHA??git(["rev-parse","HEAD"]);
  if(!OBJECT_ID.test(sha))throw new Error("browser evidence requires an exact 40-character git SHA");
  const tree=git(["rev-parse",`${sha}^{tree}`]);
  if(!OBJECT_ID.test(tree))throw new Error("browser evidence requires an exact 40-character git tree");
  let ref=process.env.GITHUB_REF;
  if(!ref){
    try{ref=git(["symbolic-ref","HEAD"]);}
    catch{ref=`refs/detached/${sha}`;}
  }
  if(!EXACT_REF.test(ref))throw new Error("browser evidence requires an exact refs/* git ref");
  return{sha,tree,ref};
}
