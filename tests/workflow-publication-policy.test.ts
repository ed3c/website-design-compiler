import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

type WorkflowStep = {
  id?: unknown;
  if?: unknown;
  uses?: unknown;
  name?: unknown;
  run?: unknown;
  env?: Record<string, unknown>;
  "continue-on-error"?: unknown;
};
type WorkflowJob = { steps?: WorkflowStep[] };

test("site typecheck materializes the same generated Next contract that the production build consumes",async()=>{
  const manifest=JSON.parse(await readFile("apps/site/package.json","utf8")) as {scripts?:Record<string,unknown>};
  const nextEnvironment=await readFile("apps/site/next-env.d.ts","utf8");
  assert.equal(manifest.scripts?.typecheck,"next typegen && tsc --noEmit");
  assert.match(nextEnvironment,/\.next\/types\/routes\.d\.ts/);
  assert.match(nextEnvironment,/This file should not be edited/);
});

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

  const providerBundleStep = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .find((step) => typeof step.run === "string" && step.run.includes("pnpm media:production-config"));
  assert.match(String(providerBundleStep?.env?.WDC_PRODUCTION_PROVIDER_BUNDLE_BASE64 ?? ""), /secrets\.WDC_PRODUCTION_PROVIDER_BUNDLE_BASE64/);
  assert.match(String(providerBundleStep?.env?.WDC_PRODUCTION_PROVIDER_BUNDLE_SHA256 ?? ""), /vars\.WDC_PRODUCTION_PROVIDER_BUNDLE_SHA256/);

  const providerStatusStep = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .find((step) => typeof step.run === "string" && step.run.includes("pnpm media:production-status"));
  assert.match(String(providerStatusStep?.env?.WDC_PRODUCTION_PROVIDER_CONFIG ?? ""), /steps\.production-provider-config\.outputs\.config_path/);
  assert.match(String(providerStatusStep?.env?.WDC_PRODUCTION_REQUEST_SECRET ?? ""), /secrets\.WDC_PRODUCTION_REQUEST_SECRET/);
  assert.match(String(providerStatusStep?.env?.WDC_PRODUCTION_PROVIDER_CREDENTIAL ?? ""), /secrets\.WDC_PRODUCTION_PROVIDER_CREDENTIAL/);
});

test("human-gated failures preserve one-run review artifacts before the job fails closed", async () => {
  const workflow = parse(await readFile(".github/workflows/compiler-core.yml", "utf8")) as {
    jobs?: Record<string, WorkflowJob>;
  };
  const steps = workflow.jobs?.verify?.steps ?? [];
  const visualDirection = steps.find((step) => typeof step.run === "string" && step.run.includes("pnpm v2:visual-directions"));
  const rights = steps.find((step) => typeof step.run === "string" && step.run.includes("pnpm rights:clearance"));
  const runtimeGates = steps.find((step) => step.id === "runtime-gates");
  const evidenceIndex = steps.findIndex((step) => step.id === "compiler-core-evidence");
  const enforcementIndex = steps.findIndex((step) => step.id === "enforce-verification");
  const enforcement = steps[enforcementIndex];

  assert.equal(visualDirection?.id, "visual-direction");
  assert.equal(visualDirection?.["continue-on-error"], true);
  assert.equal(rights?.id, "rights-clearance");
  assert.equal(rights?.["continue-on-error"], true);
  assert.equal(runtimeGates?.["continue-on-error"], true);
  assert.ok(evidenceIndex >= 0, "the all-path evidence upload must exist");
  assert.ok(enforcementIndex > evidenceIndex, "verification must fail only after evidence upload");
  assert.equal(enforcement?.if, "always()");
  assert.match(String(enforcement?.env?.VISUAL_DIRECTION_OUTCOME ?? ""), /steps\.visual-direction\.outcome/);
  assert.match(String(enforcement?.env?.RIGHTS_CLEARANCE_OUTCOME ?? ""), /steps\.rights-clearance\.outcome/);
  assert.match(String(enforcement?.env?.RUNTIME_GATES_OUTCOME ?? ""), /steps\.runtime-gates\.outcome/);
  assert.match(String(enforcement?.run ?? ""), /exit 1/);
});
