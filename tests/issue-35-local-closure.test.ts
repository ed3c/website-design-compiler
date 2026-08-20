import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCommandResults, OWNING_CLOSURE_COMMANDS, summarizeGeneratedPageReport } from "../scripts/issue-35-local-closure-receipt.js";
import { validateAgainstSchema } from "../src/validate.js";
import { ARENA_CATEGORIES } from "../src/arena.js";

const git = { ref: "refs/heads/test", sha: "a".repeat(40), tree: "b".repeat(40) };
const categories = ARENA_CATEGORIES;
const projects = ["desktop-chromium", "tablet-chromium", "mobile-chromium", "reduced-motion-chromium"];

function passingCommandResults() {
  return {
    schema: "website-design-compiler/issue-35-closure-command-results/v1",
    git,
    commands: OWNING_CLOSURE_COMMANDS.map((command) => ({ command, verdict: "PASS", exitCode: 0, evidence: [] })),
    cleanup: { state: "PASS", devServer: "PASS", playwright: "PASS", payload: "PASS", temporaryRuntimeState: "PASS", retainedEvidence: ["artifacts/handoff/issue-35-puck-runtime.json"] },
    residualNotExercised: [{ lane: "hosted-payload", state: "NOT_EXERCISED", reason: "Local SQLite is the admitted issue lane." }]
  };
}

test("closure command input requires every owning command, zero exit codes, exact lineage, and explicit cleanup", () => {
  const pass = evaluateCommandResults(passingCommandResults(), git);
  assert.equal(pass.state, "PASS");
  assert.equal(pass.sameLineage, "PASS");
  assert.equal(pass.commands.length, 11);

  const nonzero = passingCommandResults();
  nonzero.commands[8]!.exitCode = 1;
  const failed = evaluateCommandResults(nonzero, git);
  assert.equal(failed.state, "FAIL");
  assert.ok(failed.failures.includes("command-results:pnpm browser:typecheck:pass-without-zero-exit"));

  const absent = evaluateCommandResults(null, git);
  assert.equal(absent.state, "ABSENT");
  assert.ok(absent.commands.every((command) => command.verdict === "NOT_EXERCISED"));
});

test("generated-page browser proof requires all 24 project/category cases and the semantic-order and overflow assertions", () => {
  const report = {
    suites: [{
      specs: categories.map((category) => ({
        title: `${category} generated page consumes responsive and motion contracts`,
        file: "generated-pages.spec.ts",
        ok: true,
        tests: projects.map((projectName) => ({ projectName, status: "expected", results: [{ status: "passed" }] }))
      }))
    }]
  };
  const source = "expect(indices).toEqual(indices.map((_,index)=>index)); expect(runtimeLayout.documentHorizontalOverflow).toBe(false); expect(runtimeLayout.nodeHorizontalOverflow).toEqual([]); expect(runtimeLayout.unsafeHorizontalScroll).toEqual([]);";
  const pass = summarizeGeneratedPageReport(report, source);
  assert.deepEqual({ state: pass.state, passedCases: pass.passedCases, semanticOrder: pass.semanticOrder, horizontalOverflow: pass.horizontalOverflow }, { state: "PASS", passedCases: 24, semanticOrder: "PASS", horizontalOverflow: "PASS" });

  report.suites[0]!.specs[0]!.tests.pop();
  const missing = summarizeGeneratedPageReport(report, source);
  assert.equal(missing.state, "FAIL");
  assert.deepEqual(missing.missing, ["b2b-product/reduced-motion-chromium"]);
  assert.equal(summarizeGeneratedPageReport(report, "expect(runtimeLayout.documentHorizontalOverflow); expect(runtimeLayout.nodeHorizontalOverflow); expect(runtimeLayout.unsafeHorizontalScroll)").semanticOrder, "FAIL");
});

test("local closure schema accepts an explicit FAIL receipt and rejects omitted runtime controls", async () => {
  const absentReceipt = (path: string) => ({ path, sha256: null, state: "ABSENT", sameLineage: "ABSENT" });
  const receipt = {
    schema: "website-design-compiler/issue-35-local-closure/v1",
    overall: "FAIL",
    git: { ...git, trackedWorktreeClean: true },
    predecessors: {
      state: "ABSENT",
      puck: absentReceipt("artifacts/handoff/issue-35-puck-runtime.json"),
      payload: absentReceipt("artifacts/handoff/issue-35-payload-runtime.json"),
      chainDigest: "ABSENT",
      graphConsistency: "ABSENT"
    },
    commandResults: { path: "artifacts/handoff/issue-35-closure-command-results.json", sha256: null, state: "ABSENT", sameLineage: "ABSENT" },
    commands: OWNING_CLOSURE_COMMANDS.map((command) => ({ command, verdict: "NOT_EXERCISED", exitCode: null, evidence: [] })),
    browser: {
      receipt: absentReceipt("artifacts/generated-pages/generated-page-browser-receipt.json"),
      screenshots: { state: "ABSENT", expected: 18, observed: 0, distinctHashes: 0, inventory: [], missing: [], unexpected: [], digestMismatches: [] },
      runtimeAssertions: {
        state: "ABSENT",
        reportPath: "artifacts/browser-qa/playwright-report.json",
        reportSha256: null,
        testSourcePath: "tests/browser/generated-pages.spec.ts",
        testSourceSha256: null,
        expectedCases: 24,
        passedCases: 0,
        semanticOrder: "ABSENT",
        horizontalOverflow: "ABSENT",
        missing: [],
        failed: []
      }
    },
    cleanup: { state: "NOT_EXERCISED", devServer: "NOT_EXERCISED", playwright: "NOT_EXERCISED", payload: "NOT_EXERCISED", temporaryRuntimeState: "NOT_EXERCISED", retainedEvidence: [] },
    residualNotExercised: [],
    failures: ["command-results:absent"]
  };
  await validateAgainstSchema(receipt, "issue-35-local-closure.schema.json");
  const malformed = structuredClone(receipt) as Record<string, any>;
  delete malformed.browser.runtimeAssertions.horizontalOverflow;
  await assert.rejects(validateAgainstSchema(malformed, "issue-35-local-closure.schema.json"), /horizontalOverflow/);
});
