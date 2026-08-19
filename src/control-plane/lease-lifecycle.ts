import { createHash } from "node:crypto";
import type { ExecutionLease } from "./contracts.js";

export type LeaseLifecycleState = "ACTIVE" | "CHECKPOINTED" | "RELEASED" | "LOST" | "EXPIRED";
export type LeaseLifecycleEvent =
  | { kind: "CHECKPOINT"; at: string; checkpointSha256: string }
  | { kind: "RELEASE"; at: string; reason: string }
  | { kind: "LOSE"; at: string; reason: string }
  | { kind: "EXPIRE"; at: string; reason: string };

export interface LeaseLifecycleSnapshot {
  schema: "website-design-compiler/lease-lifecycle-snapshot/v1";
  leaseIdentitySha256: string;
  leaseWindowIdentitySha256: string;
  taskIdentitySha256: string;
  attemptId: string;
  headSha: string;
  issuedAt: string;
  expiresAt: string;
  state: LeaseLifecycleState;
  checkpointSha256: string | null;
  terminalReason: string | null;
  transitionedAt: string;
  lifecycleIdentitySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const TERMINAL = new Set<LeaseLifecycleState>(["RELEASED", "LOST", "EXPIRED"]);

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

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be non-empty`);
  if (/\/(?:Users|home)\//.test(normalized) || /(?:password|token|secret|credential)\s*=/i.test(normalized)) {
    throw new Error(`${field} must not contain machine-private paths or secret assignments`);
  }
  return normalized;
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

function exactTimestamp(value: string, field: string): string {
  const normalized = nonEmpty(value, field);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) throw new Error(`${field} must be an exact ISO-8601 UTC timestamp`);
  return normalized;
}

function leaseWindowIdentity(lease: ExecutionLease): string {
  return digest({
    schema: "website-design-compiler/lease-window/v1",
    leaseIdentitySha256: exactSha256(lease.leaseIdentitySha256, "leaseIdentitySha256"),
    taskIdentitySha256: exactSha256(lease.taskIdentitySha256, "taskIdentitySha256"),
    attemptId: nonEmpty(lease.attemptId, "attemptId"),
    headSha: exactGitSha(lease.headSha, "headSha"),
    writeset: [...lease.writeset].sort(),
    issuedAt: exactTimestamp(lease.issuedAt, "issuedAt"),
    expiresAt: exactTimestamp(lease.expiresAt, "expiresAt")
  });
}

function snapshotIdentity(snapshot: Omit<LeaseLifecycleSnapshot, "lifecycleIdentitySha256">): string {
  return digest(snapshot);
}

function assertWindowBinding(snapshot: LeaseLifecycleSnapshot, lease: ExecutionLease): void {
  if (snapshot.leaseIdentitySha256 !== lease.leaseIdentitySha256) throw new Error("lease identity drifted");
  if (snapshot.leaseWindowIdentitySha256 !== leaseWindowIdentity(lease)) {
    throw new Error("lease validity window drifted or was replayed");
  }
  if (snapshot.taskIdentitySha256 !== lease.taskIdentitySha256 || snapshot.attemptId !== lease.attemptId || snapshot.headSha !== lease.headSha) {
    throw new Error("lease subject or attempt drifted");
  }
}

function materialize(
  lease: ExecutionLease,
  state: LeaseLifecycleState,
  transitionedAt: string,
  checkpointSha256: string | null,
  terminalReason: string | null
): LeaseLifecycleSnapshot {
  const withoutIdentity = {
    schema: "website-design-compiler/lease-lifecycle-snapshot/v1" as const,
    leaseIdentitySha256: exactSha256(lease.leaseIdentitySha256, "leaseIdentitySha256"),
    leaseWindowIdentitySha256: leaseWindowIdentity(lease),
    taskIdentitySha256: exactSha256(lease.taskIdentitySha256, "taskIdentitySha256"),
    attemptId: nonEmpty(lease.attemptId, "attemptId"),
    headSha: exactGitSha(lease.headSha, "headSha"),
    issuedAt: exactTimestamp(lease.issuedAt, "issuedAt"),
    expiresAt: exactTimestamp(lease.expiresAt, "expiresAt"),
    state,
    checkpointSha256,
    terminalReason,
    transitionedAt: exactTimestamp(transitionedAt, "transitionedAt")
  };
  return { ...withoutIdentity, lifecycleIdentitySha256: snapshotIdentity(withoutIdentity) };
}

export function beginLeaseLifecycle(lease: ExecutionLease, now: string): LeaseLifecycleSnapshot {
  if (lease.state !== "PROPOSED") throw new Error("runtime lease lifecycle must begin from a PROPOSED contract lease");
  const at = exactTimestamp(now, "now");
  const issuedAt = exactTimestamp(lease.issuedAt, "issuedAt");
  const expiresAt = exactTimestamp(lease.expiresAt, "expiresAt");
  if (new Date(at) < new Date(issuedAt)) throw new Error("lease cannot become ACTIVE before issuedAt");
  if (new Date(at) >= new Date(expiresAt)) throw new Error("expired lease cannot become ACTIVE");
  return materialize(lease, "ACTIVE", at, null, null);
}

export function transitionLeaseLifecycle(
  current: LeaseLifecycleSnapshot,
  lease: ExecutionLease,
  event: LeaseLifecycleEvent
): LeaseLifecycleSnapshot {
  assertWindowBinding(current, lease);
  if (TERMINAL.has(current.state)) throw new Error(`terminal lease state ${current.state} cannot transition`);
  const at = exactTimestamp(event.at, "event.at");
  if (new Date(at) <= new Date(current.transitionedAt)) throw new Error("lease lifecycle events must be strictly monotonic");
  const expiresAt = new Date(lease.expiresAt);

  if (event.kind === "EXPIRE") {
    if (new Date(at) < expiresAt) throw new Error("EXPIRE cannot occur before expiresAt");
    return materialize(lease, "EXPIRED", at, current.checkpointSha256, nonEmpty(event.reason, "event.reason"));
  }

  if (new Date(at) >= expiresAt) throw new Error("stale lease must EXPIRE and cannot be reused after expiresAt");

  if (event.kind === "CHECKPOINT") {
    const checkpointSha256 = exactSha256(event.checkpointSha256, "checkpointSha256");
    return materialize(lease, "CHECKPOINTED", at, checkpointSha256, null);
  }
  if (event.kind === "RELEASE") {
    return materialize(lease, "RELEASED", at, current.checkpointSha256, nonEmpty(event.reason, "event.reason"));
  }
  return materialize(lease, "LOST", at, current.checkpointSha256, nonEmpty(event.reason, "event.reason"));
}
