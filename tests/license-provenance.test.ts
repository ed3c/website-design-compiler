import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildLicenseReceipt,
  loadLicensePolicy,
  scanWorkspace,
  type ProvenanceSubject
} from "../src/license-provenance.js";

test("policy fixtures cover allow review deny and unknown decisions", async () => {
  const policy = await loadLicensePolicy();
  const fixtureUrl = new URL("../fixtures/provenance/cases.json", import.meta.url);
  const cases = JSON.parse(await readFile(fixtureUrl, "utf8")) as Array<{
    name: string;
    expected: "PASS" | "REVIEW_REQUIRED" | "FAIL";
    subjects: ProvenanceSubject[];
  }>;

  assert.deepEqual(cases.map((entry) => entry.name), ["allow", "review", "deny", "unknown"]);
  for (const entry of cases) {
    const receipt = buildLicenseReceipt(entry.subjects, policy);
    assert.equal(receipt.overall, entry.expected, entry.name);
  }
});

test("workspace scanner joins manifest identity, lock exact versions, and rights evidence", async () => {
  const packageJson = new URL("../fixtures/provenance/workspace/package.json", import.meta.url);
  const lockfile = new URL("../fixtures/provenance/workspace/pnpm-lock.yaml", import.meta.url);
  const rights = new URL("../fixtures/provenance/workspace/rights-evidence.json", import.meta.url);
  const receipt = await scanWorkspace(packageJson.pathname, lockfile.pathname, rights.pathname);

  assert.equal(receipt.overall, "PASS");
  assert.deepEqual(
    receipt.subjects.map((result) => [result.subject.id, result.subject.versionOrCommit, result.decision]),
    [
      ["package:allowed-core", "1.2.3", "ALLOW"],
      ["package:allowed-dev", "2.4.0", "ALLOW"]
    ]
  );
});

test("missing exact version, attribution, generated-output terms, or asset hash fails closed", async () => {
  const policy = await loadLicensePolicy();
  const receipt = buildLicenseReceipt([
    {
      id: "generated:unsafe",
      kind: "generated-output",
      role: "product-core",
      license: "MIT"
    }
  ], policy);

  assert.equal(receipt.overall, "FAIL");
  assert.deepEqual(receipt.unknown, ["generated:unsafe"]);
  assert.match(receipt.subjects[0]?.reasons.join(" | ") ?? "", /exact version|attribution|output terms|asset hash/);
});
