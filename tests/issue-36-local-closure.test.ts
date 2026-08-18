import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIssue36CommandResults, ISSUE_36_COMMAND_EVIDENCE, ISSUE_36_OWNING_COMMANDS } from "../scripts/issue-36-local-closure-receipt.js";
import { validateAgainstSchema } from "../src/validate.js";

const git={ref:"refs/heads/test",sha:"a".repeat(40),tree:"b".repeat(40)};const digest="c".repeat(64);
const commandResults=()=>({schema:"website-design-compiler/issue-36-closure-command-results/v1",git:{...git},commands:ISSUE_36_OWNING_COMMANDS.map((command)=>({command,verdict:"PASS",exitCode:0,evidence:ISSUE_36_COMMAND_EVIDENCE[command]?[{path:ISSUE_36_COMMAND_EVIDENCE[command],sha256:digest}]:[]}))});

test("issue 36 owning commands require exact lineage, exact order and zero exit codes",()=>{
  assert.equal(evaluateIssue36CommandResults(commandResults(),git).state,"PASS");
  const stale=commandResults();stale.git.sha="d".repeat(40);
  assert.ok(evaluateIssue36CommandResults(stale,git).failures.includes("command-results:lineage"));
  const nonzero=commandResults();nonzero.commands[2]!.exitCode=1;
  assert.ok(evaluateIssue36CommandResults(nonzero,git).failures.some((failure)=>failure.includes("pass-without-zero-exit")));
});

test("issue 36 local closure schema records explicit failing commands and exact evidence chain",async()=>{
  const evidence=(path:string,schema:string)=>({path,sha256:digest,schema,state:"PASS",sameLineage:"PASS"});
  const receipt={schema:"website-design-compiler/issue-36-local-closure/v1",overall:"FAIL",git:{...git,trackedWorktreeClean:true},predecessor:evidence("artifacts/handoff/issue-35-local-closure.json","website-design-compiler/issue-35-local-closure/v1"),commandResults:{...evidence("artifacts/handoff/issue-36-closure-command-results.json","website-design-compiler/issue-36-closure-command-results/v1"),state:"FAIL"},commands:ISSUE_36_OWNING_COMMANDS.map((command,index)=>({command,verdict:index===0?"FAIL":"NOT_EXERCISED",exitCode:index===0?1:null,evidence:[]})),evidence:{binding:evidence("artifacts/handoff/issue-36-evidence-binding.json","website-design-compiler/issue-36-evidence-binding/v2"),premiumRelease:evidence("artifacts/handoff/issue-36-premium-release.json","website-design-compiler/issue-36-premium-release/v1"),digestChain:"PASS"},failures:["command-results:pnpm typecheck:not-pass"]};
  await validateAgainstSchema(receipt,"issue-36-local-closure.schema.json");
  const malformed=structuredClone(receipt) as Record<string,any>;malformed.commands[0].verdict="PASS";
  await assert.rejects(validateAgainstSchema(malformed,"issue-36-local-closure.schema.json"),/then/);
  const falsePass=structuredClone(receipt) as Record<string,any>;falsePass.overall="PASS";falsePass.commandResults.state="PASS";falsePass.failures=[];
  await assert.rejects(validateAgainstSchema(falsePass,"issue-36-local-closure.schema.json"),/then/);
});
