import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

type WorkflowStep = { uses?: unknown; name?: unknown; run?: unknown; env?: Record<string, unknown> };
type WorkflowJob = { steps?: WorkflowStep[] };

test("compiler workflow avoids duplicate branch runs while verifying every published PR head", async () => {
  const workflow = parse(await readFile(".github/workflows/compiler-core.yml", "utf8")) as {
    on?: {
      push?: { branches?: unknown };
      pull_request?: { types?: unknown };
      workflow_dispatch?: unknown;
    };
    concurrency?: { group?: unknown; "cancel-in-progress"?: unknown };
    jobs?: Record<string, WorkflowJob>;
  };

  assert.deepEqual(workflow.on?.push?.branches, ["main"]);
  assert.deepEqual(workflow.on?.pull_request?.types, ["opened", "synchronize", "reopened"]);
  assert.ok(workflow.on && "workflow_dispatch" in workflow.on);
  assert.equal(typeof workflow.concurrency?.group, "string");
  assert.equal(workflow.concurrency?.["cancel-in-progress"], true);

  const externalActions = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.uses)
    .filter((uses): uses is string => typeof uses === "string");
  assert.ok(externalActions.length > 0);
  for (const action of externalActions) {
    assert.match(action, /^[^@]+@[a-f0-9]{40}$/, `${action} is not pinned to an immutable commit`);
  }

  const releaseStep = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .find((step) => typeof step.run === "string" && step.run.includes("pnpm release:v2"));
  assert.equal(releaseStep?.env?.WDC_RELEASE_PROFILE, "COMMERCIAL_PRODUCTION");
  const rightsStep = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .find((step) => typeof step.run === "string" && step.run.includes("pnpm rights:clearance"));
  assert.match(String(rightsStep?.env?.WDC_RIGHTS_WAIVERS_SHA256 ?? ""), /vars\.WDC_RIGHTS_WAIVERS_SHA256/);
});
