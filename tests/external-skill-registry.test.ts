import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  changedExternalSkillCapabilities,
  resolveExternalSkillRegistry,
  type ExternalSkillRegistry
} from "../src/external-skill-registry.js";

async function fixture(): Promise<ExternalSkillRegistry> {
  return JSON.parse(
    await readFile(new URL("../.skill-bindings/external-design-skills.json", import.meta.url), "utf8")
  ) as ExternalSkillRegistry;
}

test("pinned reference-only external registry resolves PASS", async () => {
  const registry = await fixture();
  const receipt = resolveExternalSkillRegistry(registry);
  assert.equal(receipt.overall, "PASS");
  assert.equal(receipt.primaryArtDirector, "local:art-direction");
  assert.equal(receipt.enabledCount, 2);
  assert.deepEqual(receipt.resolutions.map((entry) => entry.state), ["PASS", "PASS"]);
  assert.ok(receipt.resolutions.every((entry) => entry.identity?.startsWith("git:anthropics/skills@")));
});

test("floating source identity fails closed", async () => {
  const registry = await fixture();
  registry.entries[0]!.source.commit = "main";
  const receipt = resolveExternalSkillRegistry(registry);
  assert.equal(receipt.overall, "FAIL");
  assert.match(receipt.resolutions[0]?.reason ?? "", /exact 40-hex/);
});

test("external primary taste authority conflicts with local primary", async () => {
  const registry = await fixture();
  registry.entries[0]!.authority = "primary";
  const receipt = resolveExternalSkillRegistry(registry);
  assert.equal(receipt.overall, "FAIL");
  assert.match(receipt.resolutions[0]?.reason ?? "", /conflicts with local:art-direction/);
});

test("missing license evidence fails closed", async () => {
  const registry = await fixture();
  registry.entries[1]!.license.evidenceBlob = "";
  assert.equal(resolveExternalSkillRegistry(registry).overall, "FAIL");
});

test("capability slot cannot claim PASS without enabled admission", async () => {
  const registry = await fixture();
  registry.entries[1]!.enabled = false;
  const receipt = resolveExternalSkillRegistry(registry);
  assert.equal(receipt.overall, "FAIL");
  assert.ok(receipt.resolutions.some((entry) => entry.id === "slot:browser-qa"));
});

test("identity update returns eval capabilities that must rerun", async () => {
  const previous = await fixture();
  const current = structuredClone(previous);
  current.entries[0]!.source.commit = "a".repeat(40);
  current.entries[0]!.source.blob = "b".repeat(40);
  assert.deepEqual(changedExternalSkillCapabilities(previous, current), ["art-direction"]);
});
