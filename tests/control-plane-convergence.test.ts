import assert from "node:assert/strict";
import test from "node:test";
import {
  beginLeaseLifecycle,
  compileLocalHandoffQueue,
  createControlPlaneProgram,
  createExecutionLease,
  createVerifierReceipt,
  createWorkerResult,
  evaluateTaskStart,
  transitionLeaseLifecycle,
  verifyWorkerAndVerifier,
  type TaskPacketInput
} from "../src/control-plane/index.js";
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
    programId: "local-handoff-fixture",
    repository: "https://github.com/ed3c/website-design-compiler",
    baseSha: g("0"),
    tasks: [task("source", g("a")), task("consumer", g("b"), ["source"])]
  });
  const source = program.tasks.find((entry) => entry.taskId === "source")!;
  const consumer = program.tasks.find((entry) => entry.taskId === "consumer")!;
  const sourceLease = createExecutionLease({
    leaseId: "source-lease",
    taskIdentitySha256: source.taskIdentitySha256,
    attemptId: "source-attempt",
    headSha: source.subjectSha,
    writeset: source.writeset,
    state: "PROPOSED",
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: "2026-08-19T01:00:00.000Z"
  });
  const active = beginLeaseLifecycle(sourceLease, "2026-08-19T00:05:00.000Z");
  const released = transitionLeaseLifecycle(active, sourceLease, {
    kind: "RELEASE",
    at: "2026-08-19T00:20:00.000Z",
    reason: "worker result handed to verifier"
  });
  const worker = createWorkerResult({
    taskIdentitySha256: source.taskIdentitySha256,
    attemptId: "source-attempt",
    leaseIdentitySha256: sourceLease.leaseIdentitySha256,
    workerRole: "source-worker",
    headSha: source.subjectSha,
    state: "PASS",
    artifacts: [{ path: "artifacts/source.json", sha256: h("c") }],
    commands: [{ command: "pnpm test", exitCode: 0 }],
    diagnostics: []
  });
  const verifier = createVerifierReceipt({
    workerResultIdentitySha256: worker.workerResultIdentitySha256,
    subjectHeadSha: worker.headSha,
    verifierRole: "shadow-verifier",
    workerRole: worker.workerRole,
    state: "PASS",
    negativeControls: source.negativeControls,
    diagnostics: [],
    verifiedAt: "2026-08-19T00:25:00.000Z"
  });
  const completion = verifyWorkerAndVerifier(source, worker, verifier);
  const consumerStart = evaluateTaskStart(program, consumer.taskId, [worker], consumer.subjectSha);
  const plans = [
    {
      taskId: source.taskId,
      queueId: "lhq-source",
      owningIssue: 66,
      ownerRole: "tech-lead",
      protectedNames: [] as string[],
      commands: ["pnpm typecheck", "pnpm build", "pnpm test"],
      completionGate: "exact worker and verifier completion",
      resumePhase: "P4" as const
    },
    {
      taskId: consumer.taskId,
      queueId: "lhq-consumer",
      owningIssue: 69,
      ownerRole: "tech-lead",
      protectedNames: [] as string[],
      commands: ["pnpm typecheck", "pnpm build", "pnpm test"],
      completionGate: "convergence tests pass on exact head",
      resumePhase: "P4" as const
    }
  ];
  return { program, source, consumer, sourceLease, active, released, worker, completion, consumerStart, plans };
}

test("convergence compiles verified completion and start eligibility into COMPLETE and READY Local Handoff states", async () => {
  const { program, released, completion, consumerStart, plans } = fixture();
  const queue = compileLocalHandoffQueue({
    program,
    plans,
    startReceipts: [consumerStart],
    leaseSnapshots: [released],
    completions: [completion],
    generatedAt: "2026-08-19T00:30:00.000Z"
  });
  const sourceItem = queue.items.find((item) => item.queueId === "lhq-source")!;
  const consumerItem = queue.items.find((item) => item.queueId === "lhq-consumer")!;
  assert.equal(sourceItem.state, "COMPLETE");
  assert.equal(consumerItem.state, "READY");
  assert.equal(sourceItem.headSha, program.tasks.find((entry) => entry.taskId === "source")!.subjectSha);
  assert.deepEqual(consumerItem.expectedArtifacts, ["artifacts/consumer.json"]);
  await validateAgainstSchema(queue, "local-handoff-queue.schema.json");
});

test("an explicit ACTIVE lease produces RUNNING rather than inventing completion", () => {
  const { program, active, plans } = fixture();
  const queue = compileLocalHandoffQueue({
    program,
    plans: [plans[0]!],
    leaseSnapshots: [active],
    generatedAt: "2026-08-19T00:10:00.000Z"
  });
  assert.equal(queue.items[0]!.state, "RUNNING");
  assert.match(queue.items[0]!.blockingReason, /explicit ACTIVE lease snapshot/);
});

test("released lease without independent completion remains REVIEW_REQUIRED", () => {
  const { program, released, plans } = fixture();
  const queue = compileLocalHandoffQueue({
    program,
    plans: [plans[0]!],
    leaseSnapshots: [released],
    generatedAt: "2026-08-19T00:30:00.000Z"
  });
  assert.equal(queue.items[0]!.state, "REVIEW_REQUIRED");
});

test("tampered completion bytes fail before queue emission", () => {
  const { program, released, completion, plans } = fixture();
  const tampered = { ...completion, artifacts: [{ path: "artifacts/source.json", sha256: h("9") }] };
  assert.throws(
    () => compileLocalHandoffQueue({
      program,
      plans: [plans[0]!],
      leaseSnapshots: [released],
      completions: [tampered],
      generatedAt: "2026-08-19T00:30:00.000Z"
    }),
    /completion identity drifted/
  );
});

test("terminal failed lease cannot coexist with a verified completion", () => {
  const { program, sourceLease, active, completion, plans } = fixture();
  const lost = transitionLeaseLifecycle(active, sourceLease, {
    kind: "LOSE",
    at: "2026-08-19T00:15:00.000Z",
    reason: "worker heartbeat disappeared"
  });
  assert.throws(
    () => compileLocalHandoffQueue({
      program,
      plans: [plans[0]!],
      leaseSnapshots: [lost],
      completions: [completion],
      generatedAt: "2026-08-19T00:30:00.000Z"
    }),
    /conflicts with terminal failed lease state LOST/
  );
});

test("execution evidence without an explicit Local Handoff plan fails closed", () => {
  const { program, consumerStart, plans } = fixture();
  assert.throws(
    () => compileLocalHandoffQueue({
      program,
      plans: [plans[0]!],
      startReceipts: [consumerStart],
      generatedAt: "2026-08-19T00:30:00.000Z"
    }),
    /evidence exists without a Local Handoff plan/
  );
});
