import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { isAbsolute,join,resolve,sep } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAgainstSchema } from "../src/validate.js";

export const ISSUE_36_OWNING_COMMANDS=["pnpm typecheck","pnpm test","pnpm v3:design-quality-calibration","pnpm v3:design-quality","pnpm arena:smoke","pnpm handoff:issue-36-binding","pnpm handoff:issue-36-premium-release"] as const;
export const ISSUE_36_COMMAND_EVIDENCE:Partial<Record<(typeof ISSUE_36_OWNING_COMMANDS)[number],string>>={"pnpm v3:design-quality-calibration":"artifacts/v3/design-quality-calibration/design-quality-calibration-receipt.json","pnpm v3:design-quality":"artifacts/v3/design-quality/design-quality-eval-receipt.json","pnpm arena:smoke":"artifacts/arena/arena-score.json","pnpm handoff:issue-36-binding":"artifacts/handoff/issue-36-evidence-binding.json","pnpm handoff:issue-36-premium-release":"artifacts/handoff/issue-36-premium-release.json"};
type GitSubject={ref:string;sha:string;tree:string};type Verdict="PASS"|"FAIL"|"NOT_EXERCISED";type Evidence={path:string;sha256:string};export type Issue36Command={command:string;verdict:Verdict;exitCode:number|null;evidence:Evidence[]};
const isRecord=(value:unknown):value is Record<string,any>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);const onlyKeys=(value:Record<string,any>,keys:string[])=>Object.keys(value).every((key)=>keys.includes(key));const isHash=(value:unknown,length:40|64)=>typeof value==="string"&&new RegExp(`^[a-f0-9]{${length}}$`).test(value);const safePath=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&!isAbsolute(value)&&!value.split(/[\\/]/).includes("..");const sameGit=(value:unknown,git:GitSubject)=>isRecord(value)&&value.sha===git.sha&&value.ref===git.ref&&value.tree===git.tree;
const defaultCommands=():Issue36Command[]=>ISSUE_36_OWNING_COMMANDS.map((command)=>({command,verdict:"NOT_EXERCISED",exitCode:null,evidence:[]}));

export function evaluateIssue36CommandResults(value:unknown,git:GitSubject){
  const failures:string[]=[];if(!isRecord(value))return{state:"ABSENT" as const,sameLineage:"ABSENT" as const,commands:defaultCommands(),failures:["command-results:absent"]};
  if(value.schema!=="website-design-compiler/issue-36-closure-command-results/v1")failures.push("command-results:schema");
  if(!onlyKeys(value,["schema","git","commands"]))failures.push("command-results:unexpected-property");
  const sameLineage=sameGit(value.git,git)?"PASS" as const:"FAIL" as const;if(sameLineage!=="PASS")failures.push("command-results:lineage");
  if(!Array.isArray(value.commands)||value.commands.length!==ISSUE_36_OWNING_COMMANDS.length)failures.push("command-results:count");
  const commands:Issue36Command[]=[];
  for(const [index,expected] of ISSUE_36_OWNING_COMMANDS.entries()){
    const entry=Array.isArray(value.commands)?value.commands[index]:null;const evidence:Evidence[]=[];
    if(!isRecord(entry)||!onlyKeys(entry,["command","verdict","exitCode","evidence"])){commands.push(defaultCommands()[index]!);failures.push(`command-results:${expected}:shape`);continue;}
    const evidenceValid=Array.isArray(entry.evidence)&&entry.evidence.every((item:unknown)=>{if(!isRecord(item)||!safePath(item.path)||!isHash(item.sha256,64))return false;evidence.push({path:item.path,sha256:item.sha256});return true;});
    const verdict:Verdict=entry.verdict==="PASS"||entry.verdict==="FAIL"||entry.verdict==="NOT_EXERCISED"?entry.verdict:"NOT_EXERCISED";const exitCode=entry.exitCode===null||Number.isInteger(entry.exitCode)?entry.exitCode:null;
    if(entry.command!==expected||!evidenceValid)failures.push(`command-results:${expected}:identity-or-evidence`);
    const expectedEvidence=ISSUE_36_COMMAND_EVIDENCE[expected];if(expectedEvidence?(evidence.length!==1||evidence[0]?.path!==expectedEvidence):evidence.length!==0)failures.push(`command-results:${expected}:evidence-contract`);
    if(verdict==="PASS"&&exitCode!==0)failures.push(`command-results:${expected}:pass-without-zero-exit`);
    if(verdict!=="PASS"||exitCode!==0)failures.push(`command-results:${expected}:not-pass`);
    commands.push({command:expected,verdict,exitCode,evidence});
  }
  return{state:failures.length===0?"PASS" as const:"FAIL" as const,sameLineage,commands,failures};
}

const sha256=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
async function validated(root:string,path:string,schema:string){try{const bytes=await readFile(join(root,path));const value=await validateAgainstSchema<any>(JSON.parse(bytes.toString("utf8")),schema);return{state:"PASS" as const,bytes,value};}catch(error){console.error(`${path}: unavailable or invalid: ${error instanceof Error?error.message:String(error)}`);return{state:isRecord(error)&&error.code==="ENOENT"?"ABSENT" as const:"FAIL" as const,bytes:null,value:null};}}
async function main(){
  const root=process.cwd();const git={ref:execFileSync("git",["symbolic-ref","--quiet","HEAD"],{encoding:"utf8"}).trim(),sha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),tree:execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim(),trackedWorktreeClean:execFileSync("git",["status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim()===""};
  const subject:GitSubject={ref:git.ref,sha:git.sha,tree:git.tree};const failures:string[]=[];if(!git.trackedWorktreeClean)failures.push("git:tracked-worktree-dirty");
  const commandPath=process.env.WDC_ISSUE_36_COMMAND_RESULTS??process.argv[2]??"artifacts/handoff/issue-36-closure-command-results.json";let commandBytes:Buffer|null=null;let commandValue:unknown=null;
  if(!safePath(commandPath)||!(resolve(root,commandPath).startsWith(`${root}${sep}`))){failures.push("command-results:path");}else try{commandBytes=await readFile(join(root,commandPath));commandValue=JSON.parse(commandBytes.toString("utf8"));}catch(error){console.error(`${commandPath}: unavailable or invalid: ${error instanceof Error?error.message:String(error)}`);failures.push("command-results:absent-or-invalid");}
  const command=evaluateIssue36CommandResults(commandValue,subject);failures.push(...command.failures);let commandEvidencePass=true;for(const item of command.commands.flatMap((entry)=>entry.evidence))try{if(sha256(await readFile(join(root,item.path)))!==item.sha256)throw new Error("digest mismatch");}catch(error){console.error(`${item.path}: command evidence invalid: ${error instanceof Error?error.message:String(error)}`);commandEvidencePass=false;failures.push(`command-evidence:${item.path}`);}
  const predecessorPath="artifacts/handoff/issue-35-local-closure.json",bindingPath="artifacts/handoff/issue-36-evidence-binding.json",premiumPath="artifacts/handoff/issue-36-premium-release.json";
  const predecessor=await validated(root,predecessorPath,"issue-35-local-closure.schema.json"),binding=await validated(root,bindingPath,"issue-36-evidence-binding.schema.json"),premium=await validated(root,premiumPath,"issue-36-premium-release.schema.json");
  const predecessorPass=predecessor.state==="PASS"&&predecessor.value.overall==="PASS"&&sameGit(predecessor.value.git,subject);const bindingPass=binding.state==="PASS"&&binding.value.overall==="PASS"&&sameGit(binding.value.git,subject);const premiumPass=premium.state==="PASS"&&premium.value.overall==="PASS"&&sameGit(premium.value.git,subject);
  if(!predecessorPass)failures.push("predecessor:issue-35");if(!bindingPass)failures.push("evidence:binding");if(!premiumPass)failures.push("evidence:premium-release");
  const bindingDigest=binding.bytes?sha256(binding.bytes):null;const digestChain=premium.value?.evidence?.binding?.path===bindingPath&&premium.value?.evidence?.binding?.sha256===bindingDigest?"PASS" as const:"FAIL" as const;if(digestChain!=="PASS")failures.push("evidence:digest-chain");
  const evidence=(path:string,schema:string,read:any,pass:boolean)=>({path,sha256:read.bytes?sha256(read.bytes):null,schema,state:pass?"PASS":read.state==="ABSENT"?"ABSENT":"FAIL",sameLineage:read.value&&sameGit(read.value.git,subject)?"PASS":read.state==="ABSENT"?"ABSENT":"FAIL"});
  const allPass=git.trackedWorktreeClean&&command.state==="PASS"&&commandEvidencePass&&predecessorPass&&bindingPass&&premiumPass&&digestChain==="PASS"&&failures.length===0;
  const receipt={schema:"website-design-compiler/issue-36-local-closure/v1",overall:allPass?"PASS":"FAIL",git,predecessor:evidence(predecessorPath,"website-design-compiler/issue-35-local-closure/v1",predecessor,predecessorPass),commandResults:{path:commandPath,sha256:commandBytes?sha256(commandBytes):null,schema:"website-design-compiler/issue-36-closure-command-results/v1",state:command.state,sameLineage:command.sameLineage},commands:command.commands,evidence:{binding:evidence(bindingPath,"website-design-compiler/issue-36-evidence-binding/v2",binding,bindingPass),premiumRelease:evidence(premiumPath,"website-design-compiler/issue-36-premium-release/v1",premium,premiumPass),digestChain},failures:[...new Set(failures)].sort()};
  await validateAgainstSchema(receipt,"issue-36-local-closure.schema.json");await mkdir(join(root,"artifacts","handoff"),{recursive:true});await writeFile(join(root,"artifacts","handoff","issue-36-local-closure.json"),`${JSON.stringify(receipt,null,2)}\n`);console.log(JSON.stringify({overall:receipt.overall,failures:receipt.failures}));if(receipt.overall!=="PASS")process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
