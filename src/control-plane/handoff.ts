import { createHash } from "node:crypto";
import type { ArtifactDigest, TaskPacket, VerifierReceipt, WorkerResult } from "./contracts.js";

export interface VerifiedTaskCompletion {
  schema: "website-design-compiler/verified-task-completion/v1";
  taskId: string;
  taskIdentitySha256: string;
  subjectHeadSha: string;
  workerResultIdentitySha256: string;
  verifierReceiptIdentitySha256: string;
  artifacts: ArtifactDigest[];
  completionIdentitySha256: string;
}

export interface ZeroContextHandoffPacket {
  schema: "website-design-compiler/zero-context-handoff/v1";
  fromTaskId: string;
  toTaskId: string;
  dependencyCompletionIdentitySha256: string;
  nextTaskIdentitySha256: string;
  nextSubjectSha: string;
  allowedWriteset: string[];
  excludedPaths: string[];
  requiredArtifacts: string[];
  negativeControls: string[];
  predecessorArtifacts: ArtifactDigest[];
  packetIdentitySha256: string;
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

function normalizedArtifacts(values: readonly ArtifactDigest[]): ArtifactDigest[] {
  const output = values.map((artifact) => ({ path: artifact.path, sha256: exactSha256(artifact.sha256, "artifact.sha256") }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const seen = new Set<string>();
  for (const artifact of output) {
    if (!artifact.path || artifact.path.startsWith("/") || artifact.path.includes("\\") || artifact.path.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new Error(`artifact path is not repository-relative: ${artifact.path}`);
    }
    if (seen.has(artifact.path)) throw new Error(`duplicate artifact path: ${artifact.path}`);
    seen.add(artifact.path);
  }
  return output;
}

function artifactOwned(path: string, writeset: readonly string[]): boolean {
  return writeset.some((owned) => path === owned || path.startsWith(`${owned.replace(/\/$/, "")}/`));
}

function workerIdentity(worker: WorkerResult): string {
  return digest({
    schema: "website-design-compiler/worker-result/v1",
    taskIdentitySha256: worker.taskIdentitySha256,
    attemptId: worker.attemptId,
    leaseIdentitySha256: worker.leaseIdentitySha256,
    workerRole: worker.workerRole,
    headSha: worker.headSha,
    state: worker.state,
    artifacts: normalizedArtifacts(worker.artifacts),
    commands: worker.commands,
    diagnostics: [...worker.diagnostics].sort()
  });
}

function verifierIdentity(verifier: VerifierReceipt): string {
  return digest({
    schema: "website-design-compiler/verifier-receipt/v1",
    workerResultIdentitySha256: verifier.workerResultIdentitySha256,
    subjectHeadSha: verifier.subjectHeadSha,
    verifierRole: verifier.verifierRole,
    workerRole: verifier.workerRole,
    state: verifier.state,
    independent: true,
    negativeControls: [...verifier.negativeControls].sort(),
    diagnostics: [...verifier.diagnostics].sort()
  });
}

export function verifyWorkerAndVerifier(
  task: TaskPacket,
  worker: WorkerResult,
  verifier: VerifierReceipt
): VerifiedTaskCompletion {
  exactSha256(task.taskIdentitySha256, "task.taskIdentitySha256");
  exactGitSha(task.subjectSha, "task.subjectSha");
  if (worker.taskIdentitySha256 !== task.taskIdentitySha256) throw new Error("worker result does not bind the exact task identity");
  if (worker.headSha !== task.subjectSha) throw new Error("worker result does not bind the exact task subject");
  if (worker.state !== "PASS") throw new Error(`worker result must PASS before handoff; got ${worker.state}`);
  const artifacts = normalizedArtifacts(worker.artifacts);
  if (worker.workerResultIdentitySha256 !== workerIdentity(worker)) throw new Error("worker result identity does not match its current bytes");
  for (const required of task.requiredArtifacts) {
    if (!artifacts.some((artifact) => artifact.path === required)) throw new Error(`required artifact is absent: ${required}`);
  }
  for (const artifact of artifacts) {
    if (!artifactOwned(artifact.path, task.writeset)) throw new Error(`worker artifact escapes task writeset: ${artifact.path}`);
  }

  if (verifier.workerResultIdentitySha256 !== worker.workerResultIdentitySha256) throw new Error("verifier does not bind the exact worker result");
  if (verifier.subjectHeadSha !== worker.headSha) throw new Error("verifier subject head drifted from worker result");
  if (verifier.workerRole !== worker.workerRole) throw new Error("verifier workerRole does not match the worker result");
  if (verifier.verifierRole === worker.workerRole) throw new Error("worker cannot self-verify");
  if (verifier.state !== "PASS") throw new Error(`verifier must PASS before handoff; got ${verifier.state}`);
  if (verifier.verifierReceiptIdentitySha256 !== verifierIdentity(verifier)) throw new Error("verifier receipt identity does not match its current bytes");
  for (const control of task.negativeControls) {
    if (!verifier.negativeControls.includes(control)) throw new Error(`verifier omitted required negative control: ${control}`);
  }

  const stable = {
    schema: "website-design-compiler/verified-task-completion/v1" as const,
    taskId: task.taskId,
    taskIdentitySha256: task.taskIdentitySha256,
    subjectHeadSha: worker.headSha,
    workerResultIdentitySha256: worker.workerResultIdentitySha256,
    verifierReceiptIdentitySha256: verifier.verifierReceiptIdentitySha256,
    artifacts
  };
  return { ...stable, completionIdentitySha256: digest(stable) };
}

export function createZeroContextHandoff(
  fromTask: TaskPacket,
  toTask: TaskPacket,
  completion: VerifiedTaskCompletion
): ZeroContextHandoffPacket {
  if (!toTask.dependsOn.includes(fromTask.taskId)) throw new Error(`next task ${toTask.taskId} does not depend on ${fromTask.taskId}`);
  if (completion.taskIdentitySha256 !== fromTask.taskIdentitySha256 || completion.subjectHeadSha !== fromTask.subjectSha) {
    throw new Error("completion does not bind the exact predecessor task");
  }
  const stable = {
    schema: "website-design-compiler/zero-context-handoff/v1" as const,
    fromTaskId: fromTask.taskId,
    toTaskId: toTask.taskId,
    dependencyCompletionIdentitySha256: exactSha256(completion.completionIdentitySha256, "completionIdentitySha256"),
    nextTaskIdentitySha256: exactSha256(toTask.taskIdentitySha256, "nextTaskIdentitySha256"),
    nextSubjectSha: exactGitSha(toTask.subjectSha, "nextSubjectSha"),
    allowedWriteset: [...toTask.writeset].sort(),
    excludedPaths: [...toTask.excludedPaths].sort(),
    requiredArtifacts: [...toTask.requiredArtifacts].sort(),
    negativeControls: [...toTask.negativeControls].sort(),
    predecessorArtifacts: normalizedArtifacts(completion.artifacts)
  };
  return { ...stable, packetIdentitySha256: digest(stable) };
}

export function validateHandoffContinuation(
  packet: ZeroContextHandoffPacket,
  completion: VerifiedTaskCompletion,
  nextTask: TaskPacket
): void {
  const { packetIdentitySha256: _packetIdentity, ...stablePacket } = packet;
  if (packet.packetIdentitySha256 !== digest(stablePacket)) throw new Error("handoff packet identity drifted");
  if (packet.dependencyCompletionIdentitySha256 !== completion.completionIdentitySha256) throw new Error("predecessor completion identity drifted");
  if (packet.nextTaskIdentitySha256 !== nextTask.taskIdentitySha256 || packet.nextSubjectSha !== nextTask.subjectSha) {
    throw new Error("next task subject drifted after handoff");
  }
  if (digest(packet.predecessorArtifacts) !== digest(normalizedArtifacts(completion.artifacts))) {
    throw new Error("predecessor artifact digests drifted after handoff");
  }
}
