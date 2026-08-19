export * from "./contracts.js";
export * from "./dag.js";
export * from "./lease-lifecycle.js";
export * from "./handoff.js";

import { createHash } from "node:crypto";
import {
  createLocalHandoffQueue,
  type ControlPlaneProgram,
  type LocalHandoffItemInput,
  type LocalHandoffQueue,
  type QueueState,
  type TaskPacket
} from "./contracts.js";
import { validateControlPlaneDag, type StartEligibilityReceipt } from "./dag.js";
import type { LeaseLifecycleSnapshot } from "./lease-lifecycle.js";
import type { VerifiedTaskCompletion } from "./handoff.js";

export interface LocalHandoffPlanItem {
  taskId: string;
  queueId: string;
  owningIssue: number;
  ownerRole: string;
  protectedNames: readonly string[];
  commands: readonly string[];
  completionGate: string;
  resumePhase: `P${0|1|2|3|4|5|6|7|8|9}`;
}

export interface CompileLocalHandoffQueueInput {
  program: ControlPlaneProgram;
  plans: readonly LocalHandoffPlanItem[];
  startReceipts?: readonly StartEligibilityReceipt[];
  leaseSnapshots?: readonly LeaseLifecycleSnapshot[];
  completions?: readonly VerifiedTaskCompletion[];
  generatedAt: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`unsupported canonical JSON value: ${typeof value}`);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function exactSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function taskById(program: ControlPlaneProgram): Map<string, TaskPacket> {
  const map = new Map<string, TaskPacket>();
  for (const task of program.tasks) map.set(task.taskId, task);
  return map;
}

function assertStartReceipt(receipt: StartEligibilityReceipt, program: ControlPlaneProgram, task: TaskPacket): void {
  const { receiptIdentitySha256, ...stable } = receipt;
  if (receiptIdentitySha256 !== digest(stable)) throw new Error(`start receipt identity drifted for ${task.taskId}`);
  if (receipt.programIdentitySha256 !== program.programIdentitySha256) throw new Error(`start receipt program drifted for ${task.taskId}`);
  if (receipt.taskId !== task.taskId || receipt.taskIdentitySha256 !== task.taskIdentitySha256) {
    throw new Error(`start receipt task drifted for ${task.taskId}`);
  }
}

function assertLeaseSnapshot(snapshot: LeaseLifecycleSnapshot, task: TaskPacket): void {
  const { lifecycleIdentitySha256, ...stable } = snapshot;
  if (lifecycleIdentitySha256 !== digest(stable)) throw new Error(`lease snapshot identity drifted for ${task.taskId}`);
  if (snapshot.taskIdentitySha256 !== task.taskIdentitySha256 || snapshot.headSha !== task.subjectSha) {
    throw new Error(`lease snapshot task subject drifted for ${task.taskId}`);
  }
  exactSha256(snapshot.leaseWindowIdentitySha256, "leaseWindowIdentitySha256");
}

function assertCompletion(completion: VerifiedTaskCompletion, task: TaskPacket): void {
  const { completionIdentitySha256, ...stable } = completion;
  if (completionIdentitySha256 !== digest(stable)) throw new Error(`completion identity drifted for ${task.taskId}`);
  if (completion.taskId !== task.taskId || completion.taskIdentitySha256 !== task.taskIdentitySha256 || completion.subjectHeadSha !== task.subjectSha) {
    throw new Error(`completion task subject drifted for ${task.taskId}`);
  }
}

function uniqueByTask<T>(values: readonly T[], taskId: (value: T) => string, label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const value of values) {
    const id = taskId(value);
    if (map.has(id)) throw new Error(`duplicate ${label} for task ${id}`);
    map.set(id, value);
  }
  return map;
}

function deriveQueueState(
  task: TaskPacket,
  start: StartEligibilityReceipt | undefined,
  lease: LeaseLifecycleSnapshot | undefined,
  completion: VerifiedTaskCompletion | undefined
): { state: QueueState; reason: string } {
  if (completion) {
    if (lease && (lease.state === "LOST" || lease.state === "EXPIRED")) {
      throw new Error(`verified completion conflicts with terminal failed lease state ${lease.state} for ${task.taskId}`);
    }
    if (lease && lease.state !== "RELEASED") {
      return { state: "REVIEW_REQUIRED", reason: `verified completion exists but lease state is ${lease.state}; release evidence is still required` };
    }
    return { state: "COMPLETE", reason: "no blocker: exact worker/verifier completion is bound" };
  }

  if (lease) {
    if (lease.state === "ACTIVE" || lease.state === "CHECKPOINTED") {
      return { state: "RUNNING", reason: `no blocker: explicit ${lease.state} lease snapshot is bound` };
    }
    if (lease.state === "LOST" || lease.state === "EXPIRED") {
      return { state: "BLOCKED", reason: `lease is terminal ${lease.state}; a new attempt is required` };
    }
    if (lease.state === "RELEASED") {
      return { state: "REVIEW_REQUIRED", reason: "lease released but exact verified worker/verifier completion is absent" };
    }
  }

  if (start) {
    if (start.state === "STARTABLE") return { state: "READY", reason: "no blocker: dependency and exact-subject start gates passed" };
    return { state: "BLOCKED", reason: start.diagnostics.length > 0 ? start.diagnostics.join("; ") : "start eligibility is BLOCKED" };
  }

  return { state: "QUEUED", reason: "awaiting exact start-eligibility receipt" };
}

export function compileLocalHandoffQueue(input: CompileLocalHandoffQueueInput): LocalHandoffQueue {
  validateControlPlaneDag(input.program);
  const tasks = taskById(input.program);
  if (input.plans.length === 0) throw new Error("Local Handoff compiler requires at least one plan item");

  const plans = uniqueByTask(input.plans, (plan) => plan.taskId, "handoff plan");
  const starts = uniqueByTask(input.startReceipts ?? [], (receipt) => receipt.taskId, "start receipt");
  const leases = uniqueByTask(input.leaseSnapshots ?? [], (snapshot) => {
    const task = input.program.tasks.find((candidate) => candidate.taskIdentitySha256 === snapshot.taskIdentitySha256);
    if (!task) throw new Error("lease snapshot references an unknown task identity");
    return task.taskId;
  }, "lease snapshot");
  const completions = uniqueByTask(input.completions ?? [], (completion) => completion.taskId, "completion");

  for (const id of [...starts.keys(), ...leases.keys(), ...completions.keys()]) {
    if (!plans.has(id)) throw new Error(`execution evidence exists without a Local Handoff plan for task ${id}`);
  }

  const items: LocalHandoffItemInput[] = [...plans.values()].map((plan) => {
    const task = tasks.get(plan.taskId);
    if (!task) throw new Error(`Local Handoff plan references unknown task ${plan.taskId}`);
    const start = starts.get(task.taskId);
    const lease = leases.get(task.taskId);
    const completion = completions.get(task.taskId);
    if (start) assertStartReceipt(start, input.program, task);
    if (lease) assertLeaseSnapshot(lease, task);
    if (completion) assertCompletion(completion, task);
    const derived = deriveQueueState(task, start, lease, completion);
    return {
      queueId: plan.queueId,
      state: derived.state,
      repository: input.program.repository,
      headSha: task.subjectSha,
      owningIssue: plan.owningIssue,
      ownerRole: plan.ownerRole,
      blockingReason: derived.reason,
      protectedNames: plan.protectedNames,
      commands: plan.commands,
      expectedArtifacts: task.requiredArtifacts,
      completionGate: plan.completionGate,
      resumePhase: plan.resumePhase
    };
  });

  return createLocalHandoffQueue({ programId: input.program.programId, items, generatedAt: input.generatedAt });
}
