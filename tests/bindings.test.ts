import test from "node:test";
import assert from "node:assert/strict";
import { resolveSharedBindings, type RegistryProjection, type SharedBindingsFile } from "../src/bindings.js";

const bindingFile: SharedBindingsFile = {
  schema: "website-design-compiler/skill-bindings/v1",
  source: {
    repository: "ed3c/skills-shared",
    visibility: "private",
    registry: "registry.json",
    mode: "reference-only-no-vendoring",
    expectedIdentity: "fixture-sha"
  },
  bindings: [
    { name: "truth-verify-loop", purpose: "verification" },
    { name: "dual-forge-repository-loop", purpose: "optional delivery", optional: true }
  ]
};

const projection: RegistryProjection = {
  schema: "website-design-compiler/shared-registry-projection/v1",
  sourceRepository: "ed3c/skills-shared",
  sourceIdentity: "fixture-sha",
  skills: [{ name: "truth-verify-loop", identity: "fixture-truth-verify-loop@1" }]
};

test("required binding resolves and optional absence is non-fatal", () => {
  const receipt = resolveSharedBindings(bindingFile, projection);
  assert.equal(receipt.overall, "PASS");
  assert.deepEqual(receipt.resolutions.map((entry) => entry.state), ["PASS", "ABSENT"]);
});

test("missing required binding fails closed", () => {
  const receipt = resolveSharedBindings(bindingFile, { ...projection, skills: [] });
  assert.equal(receipt.overall, "FAIL");
  assert.equal(receipt.resolutions[0]?.state, "FAIL");
});

test("local shadowing of canonical shared skill fails closed", () => {
  const receipt = resolveSharedBindings(bindingFile, projection, ["truth-verify-loop"]);
  assert.equal(receipt.overall, "FAIL");
  assert.match(receipt.resolutions[0]?.reason ?? "", /shadows/);
});

test("mismatched registry source fails closed", () => {
  const receipt = resolveSharedBindings(bindingFile, {
    ...projection,
    sourceRepository: "example/other-registry"
  });
  assert.equal(receipt.overall, "FAIL");
});

test("mismatched pinned registry identity fails closed", () => {
  const receipt = resolveSharedBindings(bindingFile, {
    ...projection,
    sourceIdentity: "fixture-sha-drifted"
  });
  assert.equal(receipt.overall, "FAIL");
  assert.match(receipt.resolutions[0]?.reason ?? "", /identity/);
});
