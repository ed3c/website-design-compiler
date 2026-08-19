import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createControlPlaneProgram,
  createExecutionLease,
  createLocalHandoffQueue,
  createTaskPacket,
  createVerifierReceipt,
  createWorkerResult,
  type ControlPlaneProgramInput
} from "../src/control-plane/contracts.js";
import { validateAgainstSchema } from "../src/validate.js";

const h = (value: string) => value.repeat(64).slice(0, 64);
const head = "8".repeat(40);

async function programFixture(): Promise<ControlPlaneProgramInput> {
  return JSON.parse(await readFile("fixtures/control-plane/parallel-join-input.json", "utf8")) as ControlPlaneProgramInput;
}

test("program fixture preserves two parallel leaves and one explicit convergence join", async () => {
  const program = createControlPlaneProgram(await programFixture());
  assert.deepEqual(program.tasks.map((task) => task.taskId), ["leaf-a", "leaf-b", "source-join"]);
  assert.deepEqual(program.tasks.find((task) => task.taskId === "leaf-a")!.dependsOn, []);
  assert.deepEqual(program.tasks.find((task) => task.taskId === "leaf-b")!.dependsOn, []);
  assert.deepEqual(program.tasks.find((task) => task.taskId === "source-join")!.dependsOn, ["leaf-a", "leaf-b"]);
  assert.notEqual(program.tasks[0]!.taskIdentitySha256, program.tasks[1]!.taskIdentitySha256);
  await validateAgainstSchema(program, "control-plane-program.schema.json");
  for (const task of program.tasks) await validateAgainstSchema(task, "task-packet.schema.json");
});

test("task identity is deterministic under caller ordering and changes with writeset or subject", () => {
  const base = {
    taskId: "test-task",
    role: "worker",
    subjectSha: head,
    dependsOn: ["dep-b", "dep-a"],
    writeset: ["src/b.ts", "src/a.ts"],
    excludedPaths: ["README.md"],
    convergenceOwner: null,
    requiredArtifacts: ["artifacts/b.json", "artifacts/a.json"],
    negativeControls: ["b fails", "a fails"]
  };
  const first = createTaskPacket(base);
  const reordered = createTaskPacket({ ...base, dependsOn: [...base.dependsOn].reverse(), writeset: [...base.writeset].reverse(), requiredArtifacts: [...base.requiredArtifacts].reverse(), negativeControls: [...base.negativeControls].reverse() });
  const changed = createTaskPacket({ ...base, writeset: ["src/c.ts"] });
  assert.equal(first.taskIdentitySha256, reordered.taskIdentitySha256);
  assert.notEqual(first.taskIdentitySha256, changed.taskIdentitySha256);
});

test("program and task contracts fail closed for unknown/self dependencies traversal and writeset exclusion collision", async () => {
  const fixture = await programFixture();
  assert.throws(
    () => createControlPlaneProgram({ ...fixture, tasks: [{ ...fixture.tasks[0]!, dependsOn: ["missing-task"] }] }),
    /depends on unknown task/
  );
  assert.throws(
    () => createTaskPacket({ ...fixture.tasks[0]!, dependsOn: [fixture.tasks[0]!.taskId] }),
    /cannot depend on itself/
  );
  assert.throws(
    () => createTaskPacket({ ...fixture.tasks[0]!, writeset: ["../private.ts"] }),
    /traversal/
  );
  assert.throws(
    () => createTaskPacket({ ...fixture.tasks[0]!, excludedPaths: [fixture.tasks[0]!.writeset[0]!] }),
    /writeset cannot also be excluded/
  );
});

test("execution lease binds task attempt head and public writeset with explicit time bounds", async () => {
  const task = createTaskPacket((await programFixture()).tasks[0]!);
  const lease = createExecutionLease({
    leaseId: "lease-001",
    taskIdentitySha256: task.taskIdentitySha256,
    attemptId: "attempt-001",
    headSha: head,
    writeset: task.writeset,
    state: "ACTIVE",
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: "2026-08-19T01:00:00.000Z"
  });
  assert.equal(lease.state, "ACTIVE");
  await validateAgainstSchema(lease, "execution-lease.schema.json");
  assert.throws(
    () => createExecutionLease({ ...lease, issuedAt: "2026-08-19T02:00:00.000Z", expiresAt: "2026-08-19T01:00:00.000Z" }),
    /expiresAt must be after issuedAt/
  );
});

test("PASS worker result requires real artifacts zero-exit commands and no diagnostics", async () => {
  const task = createTaskPacket((await programFixture()).tasks[0]!);
  const lease = createExecutionLease({ leaseId:"lease-002", taskIdentitySha256:task.taskIdentitySha256, attemptId:"attempt-002", headSha:head, writeset:task.writeset, state:"RELEASED", issuedAt:"2026-08-19T00:00:00.000Z", expiresAt:"2026-08-19T01:00:00.000Z" });
  const result = createWorkerResult({
    taskIdentitySha256: task.taskIdentitySha256,
    attemptId: "attempt-002",
    leaseIdentitySha256: lease.leaseIdentitySha256,
    workerRole: "article-worker",
    headSha: head,
    state: "PASS",
    artifacts: [{ path: "artifacts/control-plane/leaf-a.json", sha256: h("a") }],
    commands: [{ command: "pnpm test", exitCode: 0 }],
    diagnostics: []
  });
  await validateAgainstSchema(result, "worker-result.schema.json");
  assert.throws(() => createWorkerResult({ ...result, commands:[{command:"pnpm test",exitCode:1}] }), /PASS worker result requires/);
  assert.throws(() => createWorkerResult({ ...result, artifacts:[] }), /PASS worker result requires/);
  assert.throws(() => createWorkerResult({ ...result, diagnostics:["failure"] }), /PASS worker result requires/);
});

test("verifier receipt is structurally independent from the worker role", async () => {
  const receipt = createVerifierReceipt({
    workerResultIdentitySha256: h("b"),
    subjectHeadSha: head,
    verifierRole: "independent-verifier",
    workerRole: "article-worker",
    state: "PASS",
    negativeControls: ["mutated artifact fails", "stale head fails"],
    diagnostics: [],
    verifiedAt: "2026-08-19T01:00:00.000Z"
  });
  assert.equal(receipt.independent, true);
  await validateAgainstSchema(receipt, "verifier-receipt.schema.json");
  assert.throws(
    () => createVerifierReceipt({ ...receipt, verifierRole: "article-worker" }),
    /must be independent/
  );
  assert.throws(
    () => createVerifierReceipt({ ...receipt, diagnostics: ["unresolved"] }),
    /PASS verifier receipt cannot carry diagnostics/
  );
});

test("Local Handoff Queue exposes protected names only and rejects secret values or private machine paths", async () => {
  const queue = createLocalHandoffQueue({
    programId: "public-wave-fixture",
    generatedAt: "2026-08-19T02:00:00.000Z",
    items: [{
      queueId: "lhq-001",
      state: "BLOCKED",
      repository: "https://github.com/ed3c/website-design-compiler",
      headSha: head,
      owningIssue: 25,
      ownerRole: "provider-admin",
      blockingReason: "protected provider admission is absent",
      protectedNames: ["WDC_PRODUCTION_PROVIDER_CREDENTIAL", "WDC_PRODUCTION_REQUEST_SECRET"],
      commands: ["pnpm media:production-status"],
      expectedArtifacts: ["artifacts/media-generator/production-provider-status.json"],
      completionGate: "exact protected admission and runtime receipt match the same subject",
      resumePhase: "P9"
    }]
  });
  await validateAgainstSchema(queue, "local-handoff-queue.schema.json");
  assert.doesNotMatch(JSON.stringify(queue), /actual-secret-value/);
  assert.throws(() => createLocalHandoffQueue({ ...queue, items:[{...queue.items[0]!, protectedNames:["TOKEN=actual-secret-value"]}] }), /names only/);
  assert.throws(() => createLocalHandoffQueue({ ...queue, items:[{...queue.items[0]!, commands:["TOKEN=actual-secret-value pnpm test"]}] }), /secret assignments/);
  assert.throws(() => createLocalHandoffQueue({ ...queue, items:[{...queue.items[0]!, commands:["cd /home/user/private && pnpm test"]}] }), /private machine paths/);
});
