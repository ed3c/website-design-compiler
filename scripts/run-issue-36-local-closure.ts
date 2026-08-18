import { createHash } from "node:crypto";
import { execFileSync,spawnSync } from "node:child_process";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ISSUE_36_COMMAND_EVIDENCE,ISSUE_36_OWNING_COMMANDS,type Issue36Command } from "./issue-36-local-closure-receipt.js";

const root=process.cwd();const git={ref:execFileSync("git",["symbolic-ref","--quiet","HEAD"],{encoding:"utf8"}).trim(),sha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),tree:execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim()};
const environment={...process.env,GITHUB_SHA:git.sha,GITHUB_REF:git.ref};const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const commands:Issue36Command[]=[];let stopped=false;for(const command of ISSUE_36_OWNING_COMMANDS){if(stopped){commands.push({command,verdict:"NOT_EXERCISED",exitCode:null,evidence:[]});continue;}const result=spawnSync("pnpm",[command.slice(5)],{cwd:root,env:environment,stdio:"inherit"});const exitCode=result.status??1;const evidence=[];const evidencePath=ISSUE_36_COMMAND_EVIDENCE[command];if(evidencePath)try{evidence.push({path:evidencePath,sha256:digest(await readFile(join(root,evidencePath)))});}catch(error){console.error(`${command}: cannot bind ${evidencePath}: ${error instanceof Error?error.message:String(error)}`);}const verdict=exitCode===0?"PASS" as const:"FAIL" as const;commands.push({command,verdict,exitCode,evidence});if(verdict==="FAIL")stopped=true;}
const receipt={schema:"website-design-compiler/issue-36-closure-command-results/v1",git,commands};await mkdir(join(root,"artifacts","handoff"),{recursive:true});await writeFile(join(root,"artifacts","handoff","issue-36-closure-command-results.json"),`${JSON.stringify(receipt,null,2)}\n`);console.log(JSON.stringify({stopped,commands:commands.map(({command,verdict})=>({command,verdict}))}));if(stopped)process.exitCode=1;
