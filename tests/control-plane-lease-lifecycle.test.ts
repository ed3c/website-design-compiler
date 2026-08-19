import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionLease } from "../src/control-plane/contracts.js";
import { beginLeaseLifecycle, transitionLeaseLifecycle } from "../src/control-plane/lease-lifecycle.js";
import { validateAgainstSchema } from "../src/validate.js";

const g = (value: string) => value.repeat(40).slice(0, 40);
const h = (value: string) => value.repeat(64).slice(0, 64);

function lease(issuedAt = "2026-08-19T00:00:00.000Z", expiresAt = "2026-08-19T01:00:00.000Z") {
  return createExecutionLease({
    leaseId: "lease-alpha",
    taskIdentitySha256: h("a"),
    attemptId: "attempt-alpha",
    headSha: g("b"),
    writeset: ["artifacts/task.json"],
    state: "PROPOSED",
    issuedAt,
    expiresAt
  });
}

test("runtime window identity binds issuedAt and expiresAt even when parent lease identity does not", () => {
  const firstLease = lease();
  const shiftedLease = lease("2026-08-19T00:10:00.000Z", "2026-08-19T01:10:00.000Z");
  assert.equal(firstLease.leaseIdentitySha256, shiftedLease.leaseIdentitySha256);
  const first = beginLeaseLifecycle(firstLease, "2026-08-19T00:20:00.000Z");
  const shifted = beginLeaseLifecycle(shiftedLease, "2026-08-19T00:20:00.000Z");
  assert.notEqual(first.leaseWindowIdentitySha256, shifted.leaseWindowIdentitySha256);
  assert.throws(
    () => transitionLeaseLifecycle(first, shiftedLease, { kind: "CHECKPOINT", at: "2026-08-19T00:30:00.000Z", checkpointSha256: h("c") }),
    /validity window drifted or was replayed/
  );
});

test("checkpoint and release remain distinct lifecycle states", async () => {
  const subject = lease();
  const active = beginLeaseLifecycle(subject, "2026-08-19T00:10:00.000Z");
  const checkpointed = transitionLeaseLifecycle(active, subject, {
    kind: "CHECKPOINT",
    at: "2026-08-19T00:20:00.000Z",
    checkpointSha256: h("c")
  });
  assert.equal(checkpointed.state, "CHECKPOINTED");
  assert.equal(checkpointed.checkpointSha256, h("c"));
  const released = transitionLeaseLifecycle(checkpointed, subject, {
    kind: "RELEASE",
    at: "2026-08-19T00:30:00.000Z",
    reason: "worker result accepted"
  });
  assert.equal(released.state, "RELEASED");
  assert.equal(released.checkpointSha256, h("c"));
  await validateAgainstSchema(released, "lease-lifecycle-snapshot.schema.json");
  assert.throws(
    () => transitionLeaseLifecycle(released, subject, { kind: "LOSE", at: "2026-08-19T00:40:00.000Z", reason: "late loss" }),
    /terminal lease state/
  );
});

test("lost lease is terminal and cannot be silently reused", () => {
  const subject = lease();
  const active = beginLeaseLifecycle(subject, "2026-08-19T00:10:00.000Z");
  const lost = transitionLeaseLifecycle(active, subject, {
    kind: "LOSE",
    at: "2026-08-19T00:15:00.000Z",
    reason: "worker heartbeat disappeared"
  });
  assert.equal(lost.state, "LOST");
  assert.throws(
    () => transitionLeaseLifecycle(lost, subject, { kind: "CHECKPOINT", at: "2026-08-19T00:20:00.000Z", checkpointSha256: h("d") }),
    /terminal lease state LOST/
  );
});

test("expired lease must enter EXPIRED and cannot checkpoint or release after the window", () => {
  const subject = lease();
  const active = beginLeaseLifecycle(subject, "2026-08-19T00:10:00.000Z");
  assert.throws(
    () => transitionLeaseLifecycle(active, subject, { kind: "CHECKPOINT", at: "2026-08-19T01:00:00.000Z", checkpointSha256: h("d") }),
    /must EXPIRE/
  );
  const expired = transitionLeaseLifecycle(active, subject, {
    kind: "EXPIRE",
    at: "2026-08-19T01:00:00.000Z",
    reason: "lease deadline reached"
  });
  assert.equal(expired.state, "EXPIRED");
});

test("lifecycle rejects non-monotonic events and private diagnostics", () => {
  const subject = lease();
  const active = beginLeaseLifecycle(subject, "2026-08-19T00:10:00.000Z");
  assert.throws(
    () => transitionLeaseLifecycle(active, subject, { kind: "LOSE", at: "2026-08-19T00:10:00.000Z", reason: "same-time replay" }),
    /strictly monotonic/
  );
  assert.throws(
    () => transitionLeaseLifecycle(active, subject, { kind: "LOSE", at: "2026-08-19T00:11:00.000Z", reason: "/home/user/private" }),
    /machine-private paths/
  );
});
