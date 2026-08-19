import assert from "node:assert/strict";
import test from "node:test";
import {
  createControlPlaneProgram,
  createVerifierReceipt,
  createWorkerResult,
  type TaskPacketInput
} from "../src/control-plane/contracts.js";
import {
  createZeroContextHandoff,
  validateHandoffContinuation,
  verifyWorkerAndVerifier
} from "../src/control-plane/handoff.js";
import { validateAgainstSchema } from "../src/validate.js";

const g = (value: string) => value.repeat(40).slice(0, 40);
const h = (value: string) => value.repeat(64).slice(0, 64);

function task(taskId: string, subjectSha: string, dependsOn: string[] = []): TaskPacketInput {
  return {
    taskId,
    role: `${taskId}-worker`,
    subjectSha,
    dependsOn,
    writeset: [`artifacts/${taskId}.json`],
    excludedPaths: ["secrets"],
    convergenceOwner: null,
    requiredArtifacts: [`artifacts/${taskId}.json`],
    negativeControls: [`${taskId} exact subject must remain bound`]
  };
}

function fixture() {
  const program = createControlPlaneProgram({
    programId: "handoff-fixture",
    repository: "https://github.com/ed3c/website-design-compiler",
    baseSha: g("0"),
    tasks: [task("source", g("a")), task("consumer", g("b"), ["source"])]
  });
  const from = program.tasks.find((entry) => entry.taskId === "source")!;
  const to = program.tasks.find((entry) => entry.taskId === "consumer")!;
  const worker = createWorkerResult({
    taskIdentitySha256: from.taskIdentitySha256,
    attemptId: "source-attempt",
    leaseIdentitySha256: h("c"),
    workerRole: "source-worker",
    headSha: from.subjectSha,
    state: "PASS",
    artifacts: [{ path: "artifacts/source.json", sha256: h("d") }],
    commands: [{ command: "pnpm test", exitCode: 0 }],
    diagnostics: []
  });
  const verifier = createVerifierReceipt({
    workerResultIdentitySha256: worker.workerResultIdentitySha256,
    subjectHeadSha: worker.headSha,
    verifierRole: "shadow-verifier",
    workerRole: worker.workerRole,
    state: "PASS",
    negativeControls: [...from.negativeControls],
    diagnostics: [],
    verifiedAt: "2026-08-19T00:20:00.000Z"
  });
  return { from, to, worker, verifier };
}

test("independent worker and verifier receipts produce a zero-context continuation packet", async () => {
  const { from, to, worker, verifier } = fixture();
  const completion = verifyWorkerAndVerifier(from, worker, verifier);
  const packet = createZeroContextHandoff(from, to, completion);
  assert.equal(packet.fromTaskId, "source");
  assert.equal(packet.toTaskId, "consumer");
  assert.equal(packet.predecessorArtifacts[0]!.sha256, h("d"));
  assert.deepEqual(packet.allowedWriteset, ["artifacts/consumer.json"]);
  validateHandoffContinuation(packet, completion, to);
  await validateAgainstSchema(packet, "zero-context-handoff.schema.json");
});

test("changed worker artifact bytes invalidate the stored worker identity", () => {
  const { from, worker, verifier } = fixture();
  const tampered = { ...worker, artifacts: [{ path: "artifacts/source.json", sha256: h("e") }] };
  assert.throws(() => verifyWorkerAndVerifier(from, tampered, verifier), /worker result identity does not match/);
});

test("worker cannot self-verify and verifier must cover task negative controls", () => {
  const { from, worker, verifier } = fixture();
  const selfVerifier = { ...verifier, verifierRole: worker.workerRole };
  assert.throws(() => verifyWorkerAndVerifier(from, worker, selfVerifier), /worker cannot self-verify/);

  const missingControl = createVerifierReceipt({
    workerResultIdentitySha256: worker.workerResultIdentitySha256,
    subjectHeadSha: worker.headSha,
    verifierRole: "shadow-verifier",
    workerRole: worker.workerRole,
    state: "PASS",
    negativeControls: ["different control"],
    diagnostics: [],
    verifiedAt: "2026-08-19T00:20:00.000Z"
  });
  assert.throws(() => verifyWorkerAndVerifier(from, worker, missingControl), /omitted required negative control/);
});

test("changed subject or predecessor artifact digests invalidate continuation", () => {
  const { from, to, worker, verifier } = fixture();
  const completion = verifyWorkerAndVerifier(from, worker, verifier);
  const packet = createZeroContextHandoff(from, to, completion);
  const driftedTask = { ...to, subjectSha: g("f") };
  assert.throws(() => validateHandoffContinuation(packet, completion, driftedTask), /next task subject drifted/);

  const driftedCompletion = { ...completion, artifacts: [{ path: "artifacts/source.json", sha256: h("f") }] };
  assert.throws(() => validateHandoffContinuation(packet, driftedCompletion, to), /artifact digests drifted/);
});

test("worker artifacts outside the declared writeset fail closed", () => {
  const { from, worker, verifier } = fixture();
  const escaped = createWorkerResult({
    taskIdentitySha256: from.taskIdentitySha256,
    attemptId: "source-attempt",
    leaseIdentitySha256: h("c"),
    workerRole: "source-worker",
    headSha: from.subjectSha,
    state: "PASS",
    artifacts: [
      { path: "artifacts/source.json", sha256: h("d") },
      { path: "other/escape.json", sha256: h("e") }
    ],
    commands: [{ command: "pnpm test", exitCode: 0 }],
    diagnostics: []
  });
  const escapedVerifier = createVerifierReceipt({
    workerResultIdentitySha256: escaped.workerResultIdentitySha256,
    subjectHeadSha: escaped.headSha,
    verifierRole: "shadow-verifier",
    workerRole: escaped.workerRole,
    state: "PASS",
    negativeControls: [...from.negativeControls],
    diagnostics: [],
    verifiedAt: "2026-08-19T00:20:00.000Z"
  });
  assert.throws(() => verifyWorkerAndVerifier(from, escaped, escapedVerifier), /escapes task writeset/);
});
