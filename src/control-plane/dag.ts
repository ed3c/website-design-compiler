import { createHash } from "node:crypto";
import type { ControlPlaneProgram, TaskPacket, WorkerResult } from "./contracts.js";

export interface ManagedWritesetOverlap {
  leftTaskId: string;
  rightTaskId: string;
  paths: string[];
  convergenceOwner: string;
}

export interface DagValidationReceipt {
  schema: "website-design-compiler/dag-validation-receipt/v1";
  programIdentitySha256: string;
  topologicalOrder: string[];
  managedWritesetOverlaps: ManagedWritesetOverlap[];
  state: "PASS";
  receiptIdentitySha256: string;
}

export interface StartEligibilityReceipt {
  schema: "website-design-compiler/start-eligibility-receipt/v1";
  programIdentitySha256: string;
  taskId: string;
  taskIdentitySha256: string;
  dependencySatisfied: boolean;
  exactSubjectBound: boolean;
  state: "STARTABLE" | "BLOCKED";
  diagnostics: string[];
  receiptIdentitySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

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

function exactGitSha(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GIT_SHA.test(normalized)) throw new Error(`${field} must be an exact 40-character Git SHA`);
  return normalized;
}

function taskMap(program: ControlPlaneProgram): Map<string, TaskPacket> {
  const map = new Map<string, TaskPacket>();
  for (const task of program.tasks) {
    if (map.has(task.taskId)) throw new Error(`duplicate taskId: ${task.taskId}`);
    map.set(task.taskId, task);
  }
  return map;
}

function topologicalOrder(program: ControlPlaneProgram, tasks: Map<string, TaskPacket>): string[] {
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const task of program.tasks) {
    indegree.set(task.taskId, task.dependsOn.length);
    for (const dependency of task.dependsOn) {
      if (!tasks.has(dependency)) throw new Error(`task ${task.taskId} depends on unknown task ${dependency}`);
      const list = children.get(dependency) ?? [];
      list.push(task.taskId);
      children.set(dependency, list);
    }
  }
  const ready = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const child of (children.get(id) ?? []).sort()) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }
  if (order.length !== program.tasks.length) {
    const cyclic = [...indegree.entries()].filter(([, count]) => count > 0).map(([id]) => id).sort();
    throw new Error(`control-plane DAG contains a cycle involving: ${cyclic.join(", ")}`);
  }
  return order;
}

function reaches(from: string, target: string, tasks: Map<string, TaskPacket>, memo: Map<string, boolean>): boolean {
  const key = `${from}->${target}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  if (from === target) return true;
  const task = tasks.get(target);
  if (!task) return false;
  const value = task.dependsOn.some((dependency) => dependency === from || reaches(from, dependency, tasks, memo));
  memo.set(key, value);
  return value;
}

function overlappingPaths(left: TaskPacket, right: TaskPacket): string[] {
  return left.writeset.filter((path) => right.writeset.includes(path)).sort();
}

export function validateControlPlaneDag(program: ControlPlaneProgram): DagValidationReceipt {
  const programIdentitySha256 = exactSha256(program.programIdentitySha256, "programIdentitySha256");
  const tasks = taskMap(program);
  const order = topologicalOrder(program, tasks);
  const memo = new Map<string, boolean>();
  const managedWritesetOverlaps: ManagedWritesetOverlap[] = [];
  const sorted = [...program.tasks].sort((a, b) => a.taskId.localeCompare(b.taskId));
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const left = sorted[leftIndex]!;
      const right = sorted[rightIndex]!;
      if (reaches(left.taskId, right.taskId, tasks, memo) || reaches(right.taskId, left.taskId, tasks, memo)) continue;
      const paths = overlappingPaths(left, right);
      if (paths.length === 0) continue;
      if (left.convergenceOwner === null || right.convergenceOwner === null || left.convergenceOwner !== right.convergenceOwner) {
        throw new Error(`parallel writeset overlap without one convergence owner: ${left.taskId} / ${right.taskId}: ${paths.join(", ")}`);
      }
      managedWritesetOverlaps.push({
        leftTaskId: left.taskId,
        rightTaskId: right.taskId,
        paths,
        convergenceOwner: left.convergenceOwner
      });
    }
  }
  const stable = {
    schema: "website-design-compiler/dag-validation-receipt/v1" as const,
    programIdentitySha256,
    topologicalOrder: order,
    managedWritesetOverlaps,
    state: "PASS" as const
  };
  return { ...stable, receiptIdentitySha256: digest(stable) };
}

export function evaluateTaskStart(
  program: ControlPlaneProgram,
  taskId: string,
  predecessorResults: readonly WorkerResult[],
  expectedSubjectSha: string
): StartEligibilityReceipt {
  validateControlPlaneDag(program);
  const tasks = taskMap(program);
  const task = tasks.get(taskId);
  if (!task) throw new Error(`unknown taskId: ${taskId}`);
  const expected = exactGitSha(expectedSubjectSha, "expectedSubjectSha");
  const exactSubjectBound = expected === task.subjectSha;
  const diagnostics: string[] = [];
  if (!exactSubjectBound) diagnostics.push(`task ${taskId} exact subject does not match expected head`);

  const dependencies = task.dependsOn.map((id) => tasks.get(id)!).sort((a, b) => a.taskId.localeCompare(b.taskId));
  const allowedIdentities = new Set(dependencies.map((dependency) => dependency.taskIdentitySha256));
  const results = new Map<string, WorkerResult>();
  for (const result of predecessorResults) {
    exactSha256(result.taskIdentitySha256, "predecessor.taskIdentitySha256");
    if (!allowedIdentities.has(result.taskIdentitySha256)) throw new Error("unexpected predecessor result for this start decision");
    if (results.has(result.taskIdentitySha256)) throw new Error("duplicate predecessor result identity");
    results.set(result.taskIdentitySha256, result);
  }

  for (const dependency of dependencies) {
    const result = results.get(dependency.taskIdentitySha256);
    if (!result) {
      diagnostics.push(`missing PASS predecessor result for ${dependency.taskId}`);
      continue;
    }
    if (result.state !== "PASS") diagnostics.push(`predecessor ${dependency.taskId} state is ${result.state}`);
    if (result.headSha !== dependency.subjectSha) diagnostics.push(`predecessor ${dependency.taskId} result is not exact-subject bound`);
  }
  const dependencySatisfied = diagnostics.every((diagnostic) => !diagnostic.startsWith("missing PASS predecessor") && !diagnostic.startsWith("predecessor "));
  const state = dependencySatisfied && exactSubjectBound ? "STARTABLE" as const : "BLOCKED" as const;
  const stable = {
    schema: "website-design-compiler/start-eligibility-receipt/v1" as const,
    programIdentitySha256: exactSha256(program.programIdentitySha256, "programIdentitySha256"),
    taskId: task.taskId,
    taskIdentitySha256: exactSha256(task.taskIdentitySha256, "taskIdentitySha256"),
    dependencySatisfied,
    exactSubjectBound,
    state,
    diagnostics: [...new Set(diagnostics)].sort()
  };
  return { ...stable, receiptIdentitySha256: digest(stable) };
}
