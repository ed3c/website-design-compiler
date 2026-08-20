import assert from "node:assert/strict";
import test from "node:test";
import { createControlPlaneProgram, createWorkerResult, type TaskPacketInput } from "../src/control-plane/contracts.js";
import { evaluateTaskStart, validateControlPlaneDag } from "../src/control-plane/dag.js";
import { validateAgainstSchema } from "../src/validate.js";

const g = (value: string) => value.repeat(40).slice(0, 40);
const h = (value: string) => value.repeat(64).slice(0, 64);

function task(taskId: string, subjectSha: string, dependsOn: string[] = [], convergenceOwner: string | null = null, writeset = [`artifacts/${taskId}.json`]): TaskPacketInput {
  return {
    taskId,
    role: `${taskId}-worker`,
    subjectSha,
    dependsOn,
    writeset,
    excludedPaths: [],
    convergenceOwner,
    requiredArtifacts: [writeset[0]!],
    negativeControls: [`${taskId} exact subject must remain bound`]
  };
}

function linearProgram() {
  return createControlPlaneProgram({
    programId: "dag-start-fixture",
    repository: "https://github.com/ed3c/website-design-compiler",
    baseSha: g("0"),
    tasks: [task("extract", g("a")), task("transform", g("b"), ["extract"])]
  });
}

test("DAG validation produces deterministic topological order", () => {
  const receipt = validateControlPlaneDag(linearProgram());
  assert.deepEqual(receipt.topologicalOrder, ["extract", "transform"]);
  assert.deepEqual(receipt.managedWritesetOverlaps, []);
  assert.equal(receipt.state, "PASS");
});

test("cycle detection fails closed", () => {
  const program = createControlPlaneProgram({
    programId: "cycle-fixture",
    repository: "https://github.com/ed3c/website-design-compiler",
    baseSha: g("0"),
    tasks: [task("alpha", g("a"), ["beta"]), task("beta", g("b"), ["alpha"])]
  });
  assert.throws(() => validateControlPlaneDag(program), /contains a cycle/);
});

test("parallel writeset overlap requires one explicit convergence owner", () => {
  const unsafe = createControlPlaneProgram({
    programId: "unsafe-overlap",
    repository: "https://github.com/ed3c/website-design-compiler",
    baseSha: g("0"),
    tasks: [task("alpha", g("a"), [], null, ["src/shared.ts"]), task("beta", g("b"), [], null, ["src/shared.ts"])]
  });
  assert.throws(() => validateControlPlaneDag(unsafe), /overlap without one convergence owner/);

  const managed = createControlPlaneProgram({
    programId: "managed-overlap",
    repository: "https://github.com/ed3c/website-design-compiler",
    baseSha: g("0"),
    tasks: [task("alpha", g("a"), [], "join-owner", ["src/shared.ts"]), task("beta", g("b"), [], "join-owner", ["src/shared.ts"])]
  });
  const receipt = validateControlPlaneDag(managed);
  assert.equal(receipt.managedWritesetOverlaps.length, 1);
  assert.equal(receipt.managedWritesetOverlaps[0]!.convergenceOwner, "join-owner");
});

test("dependency satisfaction is separate from exact-subject start eligibility", async () => {
  const program = linearProgram();
  const extract = program.tasks.find((entry) => entry.taskId === "extract")!;
  const transform = program.tasks.find((entry) => entry.taskId === "transform")!;

  const missing = evaluateTaskStart(program, "transform", [], transform.subjectSha);
  assert.equal(missing.dependencySatisfied, false);
  assert.equal(missing.exactSubjectBound, true);
  assert.equal(missing.state, "BLOCKED");

  const result = createWorkerResult({
    taskIdentitySha256: extract.taskIdentitySha256,
    attemptId: "extract-attempt",
    leaseIdentitySha256: h("f"),
    workerRole: "extract-worker",
    headSha: extract.subjectSha,
    state: "PASS",
    artifacts: [{ path: "artifacts/extract.json", sha256: h("e") }],
    commands: [{ command: "pnpm test", exitCode: 0 }],
    diagnostics: []
  });

  const startable = evaluateTaskStart(program, "transform", [result], transform.subjectSha);
  assert.equal(startable.dependencySatisfied, true);
  assert.equal(startable.exactSubjectBound, true);
  assert.equal(startable.state, "STARTABLE");
  await validateAgainstSchema(startable, "start-eligibility-receipt.schema.json");

  const drifted = evaluateTaskStart(program, "transform", [result], g("c"));
  assert.equal(drifted.dependencySatisfied, true);
  assert.equal(drifted.exactSubjectBound, false);
  assert.equal(drifted.state, "BLOCKED");
});

test("stale or unexpected predecessor receipts cannot be silently accepted", () => {
  const program = linearProgram();
  const extract = program.tasks.find((entry) => entry.taskId === "extract")!;
  const transform = program.tasks.find((entry) => entry.taskId === "transform")!;
  const stale = createWorkerResult({
    taskIdentitySha256: extract.taskIdentitySha256,
    attemptId: "extract-attempt",
    leaseIdentitySha256: h("f"),
    workerRole: "extract-worker",
    headSha: g("d"),
    state: "PASS",
    artifacts: [{ path: "artifacts/extract.json", sha256: h("e") }],
    commands: [{ command: "pnpm test", exitCode: 0 }],
    diagnostics: []
  });
  const blocked = evaluateTaskStart(program, "transform", [stale], transform.subjectSha);
  assert.equal(blocked.dependencySatisfied, false);
  assert.match(blocked.diagnostics.join(" "), /not exact-subject bound/);
});
