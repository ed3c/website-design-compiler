import { createHash } from "node:crypto";

export type ExecutionState = "PROPOSED" | "ACTIVE" | "CHECKPOINTED" | "RELEASED" | "LOST" | "EXPIRED";
export type ResultState = "PASS" | "FAIL" | "BLOCKED";
export type QueueState = "QUEUED" | "READY" | "RUNNING" | "BLOCKED" | "REVIEW_REQUIRED" | "COMPLETE" | "REJECTED" | "SUPERSEDED";

export interface TaskPacketInput {
  taskId: string;
  role: string;
  subjectSha: string;
  dependsOn: readonly string[];
  writeset: readonly string[];
  excludedPaths: readonly string[];
  convergenceOwner: string | null;
  requiredArtifacts: readonly string[];
  negativeControls: readonly string[];
}

export interface TaskPacket extends Omit<TaskPacketInput, "dependsOn" | "writeset" | "excludedPaths" | "requiredArtifacts" | "negativeControls"> {
  schema: "website-design-compiler/task-packet/v1";
  dependsOn: string[];
  writeset: string[];
  excludedPaths: string[];
  requiredArtifacts: string[];
  negativeControls: string[];
  taskIdentitySha256: string;
}

export interface ControlPlaneProgramInput {
  programId: string;
  repository: string;
  baseSha: string;
  tasks: readonly TaskPacketInput[];
}

export interface ControlPlaneProgram {
  schema: "website-design-compiler/control-plane-program/v1";
  programId: string;
  repository: string;
  baseSha: string;
  tasks: TaskPacket[];
  programIdentitySha256: string;
}

export interface ExecutionLeaseInput {
  leaseId: string;
  taskIdentitySha256: string;
  attemptId: string;
  headSha: string;
  writeset: readonly string[];
  state: ExecutionState;
  issuedAt: string;
  expiresAt: string;
}

export interface ExecutionLease extends Omit<ExecutionLeaseInput, "writeset"> {
  schema: "website-design-compiler/execution-lease/v1";
  writeset: string[];
  leaseIdentitySha256: string;
}

export interface ArtifactDigest {
  path: string;
  sha256: string;
}

export interface CommandReceipt {
  command: string;
  exitCode: number;
}

export interface WorkerResultInput {
  taskIdentitySha256: string;
  attemptId: string;
  leaseIdentitySha256: string;
  workerRole: string;
  headSha: string;
  state: ResultState;
  artifacts: readonly ArtifactDigest[];
  commands: readonly CommandReceipt[];
  diagnostics: readonly string[];
}

export interface WorkerResult extends Omit<WorkerResultInput, "artifacts" | "commands" | "diagnostics"> {
  schema: "website-design-compiler/worker-result/v1";
  artifacts: ArtifactDigest[];
  commands: CommandReceipt[];
  diagnostics: string[];
  workerResultIdentitySha256: string;
}

export interface VerifierReceiptInput {
  workerResultIdentitySha256: string;
  subjectHeadSha: string;
  verifierRole: string;
  workerRole: string;
  state: ResultState;
  negativeControls: readonly string[];
  diagnostics: readonly string[];
  verifiedAt: string;
}

export interface VerifierReceipt extends Omit<VerifierReceiptInput, "negativeControls" | "diagnostics"> {
  schema: "website-design-compiler/verifier-receipt/v1";
  independent: true;
  negativeControls: string[];
  diagnostics: string[];
  verifierReceiptIdentitySha256: string;
}

export interface LocalHandoffItemInput {
  queueId: string;
  state: QueueState;
  repository: string;
  headSha: string;
  owningIssue: number;
  ownerRole: string;
  blockingReason: string;
  protectedNames: readonly string[];
  commands: readonly string[];
  expectedArtifacts: readonly string[];
  completionGate: string;
  resumePhase: `P${0|1|2|3|4|5|6|7|8|9}`;
}

export interface LocalHandoffItem extends Omit<LocalHandoffItemInput, "protectedNames" | "commands" | "expectedArtifacts"> {
  protectedNames: string[];
  commands: string[];
  expectedArtifacts: string[];
}

export interface LocalHandoffQueueInput {
  programId: string;
  items: readonly LocalHandoffItemInput[];
  generatedAt: string;
}

export interface LocalHandoffQueue {
  schema: "website-design-compiler/local-handoff-queue/v1";
  programId: string;
  items: LocalHandoffItem[];
  generatedAt: string;
  queueIdentitySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const STABLE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const PROTECTED_NAME = /^[A-Z][A-Z0-9_]{2,127}$/;
const EXEC_STATES = new Set<ExecutionState>(["PROPOSED","ACTIVE","CHECKPOINTED","RELEASED","LOST","EXPIRED"]);
const RESULT_STATES = new Set<ResultState>(["PASS","FAIL","BLOCKED"]);
const QUEUE_STATES = new Set<QueueState>(["QUEUED","READY","RUNNING","BLOCKED","REVIEW_REQUIRED","COMPLETE","REJECTED","SUPERSEDED"]);

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("control-plane contracts cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`canonical JSON does not support ${typeof value}`);
}

function digest(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function nonEmpty(value: string, field: string): string { const v=value.trim(); if(!v) throw new Error(`${field} must be non-empty`); return v; }
function stableId(value: string, field: string): string { const v=nonEmpty(value,field); if(!STABLE_ID.test(v)) throw new Error(`${field} must be a stable lowercase identifier`); return v; }
function exactSha256(value: string, field: string): string { const v=value.trim().toLowerCase(); if(!SHA256.test(v)) throw new Error(`${field} must be an exact SHA-256`); return v; }
function gitSha(value: string, field: string): string { const v=value.trim().toLowerCase(); if(!GIT_SHA.test(v)) throw new Error(`${field} must be an exact 40-character Git SHA`); return v; }
function exactTimestamp(value: string, field: string): string { const v=nonEmpty(value,field); const d=new Date(v); if(Number.isNaN(d.valueOf())||d.toISOString()!==v) throw new Error(`${field} must be an exact ISO-8601 UTC timestamp`); return v; }

function repoUrl(value: string): string {
  let url: URL;
  try { url = new URL(nonEmpty(value,"repository")); } catch { throw new Error("repository must be a public GitHub HTTPS URL"); }
  if(url.protocol!=="https:"||url.hostname.toLowerCase()!=="github.com"||url.username||url.password||url.search||url.hash) throw new Error("repository must be a public GitHub HTTPS URL without credentials/query/fragment");
  const parts=url.pathname.split("/").filter(Boolean); if(parts.length!==2) throw new Error("repository must identify exactly owner/repository");
  return `https://github.com/${parts[0]}/${parts[1]!.replace(/\.git$/i,"")}`;
}

function repoPath(value: string, field: string): string {
  const v=nonEmpty(value,field);
  if(v.startsWith("/")||v.includes("\\")) throw new Error(`${field} must be a relative POSIX repository path`);
  const parts=v.split("/"); if(parts.some((p)=>!p||p==="."||p==="..")) throw new Error(`${field} must not contain traversal or dot segments`);
  return parts.join("/");
}

function strings(values: readonly string[], field: string, requireOne=false): string[] {
  const out=[...new Set(values.map((v)=>nonEmpty(v,field)))].sort(); if(requireOne&&out.length===0) throw new Error(`${field} requires at least one entry`); return out;
}
function paths(values: readonly string[], field: string, requireOne=false): string[] {
  const out=[...new Set(values.map((v)=>repoPath(v,field)))].sort(); if(requireOne&&out.length===0) throw new Error(`${field} requires at least one path`); return out;
}

export function createTaskPacket(input: TaskPacketInput): TaskPacket {
  const stable={
    schema:"website-design-compiler/task-packet/v1" as const,
    taskId:stableId(input.taskId,"taskId"), role:nonEmpty(input.role,"role"), subjectSha:gitSha(input.subjectSha,"subjectSha"),
    dependsOn:strings(input.dependsOn,"dependsOn"), writeset:paths(input.writeset,"writeset",true), excludedPaths:paths(input.excludedPaths,"excludedPaths"),
    convergenceOwner:input.convergenceOwner===null?null:nonEmpty(input.convergenceOwner,"convergenceOwner"), requiredArtifacts:paths(input.requiredArtifacts,"requiredArtifacts",true),
    negativeControls:strings(input.negativeControls,"negativeControls",true)
  };
  if(stable.dependsOn.includes(stable.taskId)) throw new Error("task cannot depend on itself");
  if(stable.writeset.some((p)=>stable.excludedPaths.includes(p))) throw new Error("task writeset cannot also be excluded");
  return {...stable,taskIdentitySha256:digest(stable)};
}

export function createControlPlaneProgram(input: ControlPlaneProgramInput): ControlPlaneProgram {
  const tasks=input.tasks.map(createTaskPacket).sort((a,b)=>a.taskId.localeCompare(b.taskId)); if(tasks.length===0) throw new Error("program requires at least one task");
  const ids=new Set<string>(); for(const task of tasks){ if(ids.has(task.taskId)) throw new Error(`duplicate taskId: ${task.taskId}`); ids.add(task.taskId); }
  for(const task of tasks) for(const dependency of task.dependsOn) if(!ids.has(dependency)) throw new Error(`task ${task.taskId} depends on unknown task ${dependency}`);
  const stable={schema:"website-design-compiler/control-plane-program/v1" as const,programId:stableId(input.programId,"programId"),repository:repoUrl(input.repository),baseSha:gitSha(input.baseSha,"baseSha"),tasks};
  return {...stable,programIdentitySha256:digest(stable)};
}

export function createExecutionLease(input: ExecutionLeaseInput): ExecutionLease {
  if(!EXEC_STATES.has(input.state)) throw new Error("execution lease state is invalid");
  const issuedAt=exactTimestamp(input.issuedAt,"issuedAt"), expiresAt=exactTimestamp(input.expiresAt,"expiresAt");
  if(new Date(expiresAt)<=new Date(issuedAt)) throw new Error("lease expiresAt must be after issuedAt");
  const stable={schema:"website-design-compiler/execution-lease/v1" as const,leaseId:stableId(input.leaseId,"leaseId"),taskIdentitySha256:exactSha256(input.taskIdentitySha256,"taskIdentitySha256"),attemptId:stableId(input.attemptId,"attemptId"),headSha:gitSha(input.headSha,"headSha"),writeset:paths(input.writeset,"writeset",true),state:input.state};
  return {...stable,issuedAt,expiresAt,leaseIdentitySha256:digest(stable)};
}

function artifacts(values: readonly ArtifactDigest[]): ArtifactDigest[] {
  const out=values.map((a)=>({path:repoPath(a.path,"artifact.path"),sha256:exactSha256(a.sha256,"artifact.sha256")})).sort((a,b)=>a.path.localeCompare(b.path));
  const seen=new Set<string>(); for(const a of out){if(seen.has(a.path)) throw new Error(`duplicate artifact path: ${a.path}`);seen.add(a.path);} return out;
}
function commands(values: readonly CommandReceipt[]): CommandReceipt[] { return values.map((c)=>({command:nonEmpty(c.command,"command"),exitCode:Number.isInteger(c.exitCode)?c.exitCode:(()=>{throw new Error("command exitCode must be an integer")})()})); }

export function createWorkerResult(input: WorkerResultInput): WorkerResult {
  if(!RESULT_STATES.has(input.state)) throw new Error("worker result state is invalid");
  const normalizedArtifacts=artifacts(input.artifacts), normalizedCommands=commands(input.commands), diagnostics=strings(input.diagnostics,"diagnostics");
  if(input.state==="PASS"&&(normalizedArtifacts.length===0||normalizedCommands.length===0||normalizedCommands.some((c)=>c.exitCode!==0)||diagnostics.length>0)) throw new Error("PASS worker result requires artifacts, zero-exit commands, and no diagnostics");
  const stable={schema:"website-design-compiler/worker-result/v1" as const,taskIdentitySha256:exactSha256(input.taskIdentitySha256,"taskIdentitySha256"),attemptId:stableId(input.attemptId,"attemptId"),leaseIdentitySha256:exactSha256(input.leaseIdentitySha256,"leaseIdentitySha256"),workerRole:nonEmpty(input.workerRole,"workerRole"),headSha:gitSha(input.headSha,"headSha"),state:input.state,artifacts:normalizedArtifacts,commands:normalizedCommands,diagnostics};
  return {...stable,workerResultIdentitySha256:digest(stable)};
}

export function createVerifierReceipt(input: VerifierReceiptInput): VerifierReceipt {
  if(!RESULT_STATES.has(input.state)) throw new Error("verifier state is invalid");
  const verifierRole=nonEmpty(input.verifierRole,"verifierRole"), workerRole=nonEmpty(input.workerRole,"workerRole"); if(verifierRole===workerRole) throw new Error("verifier role must be independent from worker role");
  const negativeControls=strings(input.negativeControls,"negativeControls",true), diagnostics=strings(input.diagnostics,"diagnostics"); if(input.state==="PASS"&&diagnostics.length>0) throw new Error("PASS verifier receipt cannot carry diagnostics");
  const stable={schema:"website-design-compiler/verifier-receipt/v1" as const,workerResultIdentitySha256:exactSha256(input.workerResultIdentitySha256,"workerResultIdentitySha256"),subjectHeadSha:gitSha(input.subjectHeadSha,"subjectHeadSha"),verifierRole,workerRole,state:input.state,independent:true as const,negativeControls,diagnostics};
  return {...stable,verifiedAt:exactTimestamp(input.verifiedAt,"verifiedAt"),verifierReceiptIdentitySha256:digest(stable)};
}

function safeCommand(value: string): string {
  const v=nonEmpty(value,"handoff command");
  if(/(?:password|token|secret|credential)\s*=/i.test(v)||/\/(?:Users|home)\//.test(v)) throw new Error("handoff command must not contain secret assignments or private machine paths");
  return v;
}
function handoffItem(input: LocalHandoffItemInput): LocalHandoffItem {
  if(!QUEUE_STATES.has(input.state)) throw new Error("handoff queue state is invalid");
  if(!Number.isInteger(input.owningIssue)||input.owningIssue<1) throw new Error("owningIssue must be a positive GitHub issue number");
  const protectedNames=[...new Set(input.protectedNames.map((name)=>{const v=nonEmpty(name,"protectedNames");if(!PROTECTED_NAME.test(v)) throw new Error("protectedNames must contain names only, not values");return v;}))].sort();
  return {queueId:stableId(input.queueId,"queueId"),state:input.state,repository:repoUrl(input.repository),headSha:gitSha(input.headSha,"headSha"),owningIssue:input.owningIssue,ownerRole:nonEmpty(input.ownerRole,"ownerRole"),blockingReason:nonEmpty(input.blockingReason,"blockingReason"),protectedNames,commands:[...new Set(input.commands.map(safeCommand))],expectedArtifacts:paths(input.expectedArtifacts,"expectedArtifacts",true),completionGate:nonEmpty(input.completionGate,"completionGate"),resumePhase:input.resumePhase};
}

export function createLocalHandoffQueue(input: LocalHandoffQueueInput): LocalHandoffQueue {
  const items=input.items.map(handoffItem).sort((a,b)=>a.queueId.localeCompare(b.queueId)); if(items.length===0) throw new Error("local handoff queue requires at least one item");
  const seen=new Set<string>();for(const item of items){if(seen.has(item.queueId)) throw new Error(`duplicate queueId: ${item.queueId}`);seen.add(item.queueId);}
  const stable={schema:"website-design-compiler/local-handoff-queue/v1" as const,programId:stableId(input.programId,"programId"),items};
  return {...stable,generatedAt:exactTimestamp(input.generatedAt,"generatedAt"),queueIdentitySha256:digest(stable)};
}
