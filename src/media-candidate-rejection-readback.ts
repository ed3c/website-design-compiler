import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { buildMediaCandidateRejectionReceipt, type MediaCandidateRejectionReceipt } from "./media-candidate-rejection.js";
import { validateAgainstSchema } from "./validate.js";

export interface MediaCandidateRejectionBinding {
  path: string;
  schema: string;
  sha256: string;
  bytes: number;
  sourceAdmissionSha256: string;
  trustedGitTree: string;
}

interface GitSubject {
  sha: string;
  tree?: string;
  ref: string;
}

const digestPattern=/^[a-f0-9]{64}$/;

function sameJson(left:unknown,right:unknown):boolean{
  return JSON.stringify(left)===JSON.stringify(right);
}

export async function validateMediaCandidateRejectionReadback(args:{
  root:string;
  binding:MediaCandidateRejectionBinding;
  expectedGit:GitSubject;
  trustedRightsEvidenceSha256?:string;
  trustedGitTree?:string;
}):Promise<string[]>{
  const errors:string[]=[];
  const trusted=args.trustedRightsEvidenceSha256?.trim();
  if(!trusted)errors.push("production rights evidence externally trusted SHA-256 is absent");
  else if(!digestPattern.test(trusted))errors.push("production rights evidence externally trusted SHA-256 is malformed");
  if(args.binding.path!=="media-candidate-rejection.json")errors.push("candidate rejection path is not canonical");
  if(args.binding.schema!=="website-design-compiler/media-candidate-rejection/v2")errors.push("candidate rejection schema identity is invalid");
  if(!digestPattern.test(args.binding.sha256)||!Number.isSafeInteger(args.binding.bytes)||args.binding.bytes<1)errors.push("candidate rejection artifact binding is malformed");
  if(!trusted||args.binding.sourceAdmissionSha256!==trusted)errors.push("candidate rejection binding does not match the externally trusted rights evidence SHA-256");
  const trustedTree=args.trustedGitTree?.trim();
  if(!trustedTree)errors.push("production candidate externally trusted Git tree is absent");
  else if(!/^[a-f0-9]{40}$/.test(trustedTree))errors.push("production candidate externally trusted Git tree is malformed");
  if(!trustedTree||args.binding.trustedGitTree!==trustedTree)errors.push("candidate rejection binding does not match the externally trusted Git tree");
  if(!args.expectedGit.tree)errors.push("release Git tree is absent from candidate rejection verification");
  else if(trustedTree&&args.expectedGit.tree!==trustedTree)errors.push("release Git tree does not match the externally trusted Git tree");

  const directory=resolve(args.root,"artifacts/media-generator");
  let bytes:Buffer;
  try{
    const canonicalRoot=await realpath(args.root);
    const canonicalDirectory=await realpath(directory);
    if(canonicalDirectory!==resolve(canonicalRoot,"artifacts/media-generator")){
      errors.push("candidate rejection artifact directory resolves through a symbolic link or outside the workspace");
      return errors;
    }
    const target=resolve(directory,args.binding.path);
    const canonicalTarget=await realpath(target);
    if(canonicalTarget!==resolve(canonicalDirectory,args.binding.path)){
      errors.push("candidate rejection artifact resolves through a symbolic link or outside its artifact directory");
      return errors;
    }
    bytes=await readFile(canonicalTarget);
  }catch{
    errors.push("candidate rejection artifact is missing or unreadable");
    return errors;
  }
  const observedSha256=createHash("sha256").update(bytes).digest("hex");
  if(args.binding.sha256!==observedSha256)errors.push("candidate rejection artifact SHA-256 mismatch");
  if(args.binding.bytes!==bytes.byteLength)errors.push("candidate rejection artifact byte count mismatch");

  let receipt:MediaCandidateRejectionReceipt;
  try{
    receipt=await validateAgainstSchema<MediaCandidateRejectionReceipt>(JSON.parse(bytes.toString("utf8")),"media-candidate-rejection.schema.json");
  }catch(error){
    errors.push(`candidate rejection artifact is malformed: ${error instanceof Error?error.message:"invalid receipt"}`);
    return errors;
  }
  if(receipt.git.sha!==args.expectedGit.sha||receipt.git.ref!==args.expectedGit.ref||(args.expectedGit.tree!==undefined&&receipt.git.tree!==args.expectedGit.tree))errors.push("candidate rejection artifact does not bind the exact release Git subject");
  if(receipt.overall!=="PASS"||receipt.evidenceAdmission.state!=="PASS")errors.push("candidate rejection external source admission is not PASS");
  if(trusted&&receipt.evidenceAdmission.trustedSha256!==trusted)errors.push("candidate rejection receipt does not bind the externally trusted rights evidence SHA-256");
  if(trustedTree&&receipt.evidenceAdmission.trustedGitTree!==trustedTree)errors.push("candidate rejection receipt does not bind the externally trusted Git tree");
  if(trusted&&trustedTree){
    try{
      const expected=await buildMediaCandidateRejectionReceipt(args.root,{...args.expectedGit,tree:args.expectedGit.tree??receipt.git.tree},new Date(receipt.generatedAt),trusted,trustedTree);
      if(!sameJson(receipt,expected))errors.push("candidate rejection receipt does not match current policy and rights evidence");
    }catch(error){
      errors.push(`candidate rejection receipt cannot be reconstructed: ${error instanceof Error?error.message:"unknown error"}`);
    }
  }
  return errors;
}
