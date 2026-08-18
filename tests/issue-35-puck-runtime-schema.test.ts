import assert from "node:assert/strict";
import test from "node:test";
import { validateAgainstSchema } from "../src/validate.js";

const digest = "d".repeat(64);
const semanticOrder = ["navigation", "hero", "proof", "cta", "footer"];
const receipt = {
  schema: "website-design-compiler/issue-35-puck-runtime/v1",
  overall: "PASS",
  git: {
    ref: "refs/pull/42/merge",
    sha: "a".repeat(40),
    tree: "b".repeat(40)
  },
  runtime: {
    consumer: "apps/site/components/studio/studio-editor.tsx",
    graphSource: "apps/site/generated/benchmark-page-graphs.json",
    package: "@puckeditor/core",
    version: "0.22.4"
  },
  graphs: Array.from({ length: 6 }, (_, index) => ({
    category: `fixture-${index}`,
    fingerprint: digest,
    nodeCount: semanticOrder.length,
    publishedFingerprint: digest,
    renderedSemanticOrder: semanticOrder,
    semanticOrder
  })),
  controls: {
    extraPropertyRejected: true,
    manualBenchmarkGraphRequired: false,
    unknownBlockRejected: true
  },
  commands: [{
    command: "pnpm exec playwright test tests/browser/studio.spec.ts --project=desktop-chromium",
    verdict: "PASS"
  }]
};

test("Puck runtime receipt accepts an exact GitHub pull merge ref", async () => {
  await validateAgainstSchema(receipt, "issue-35-puck-runtime.schema.json");
});

test("Puck runtime receipt still rejects an unbound git ref", async () => {
  await assert.rejects(
    validateAgainstSchema({ ...receipt, git: { ...receipt.git, ref: "UNBOUND" } }, "issue-35-puck-runtime.schema.json"),
    /pattern/
  );
});
