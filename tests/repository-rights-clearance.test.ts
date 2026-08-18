import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyWaivers, classifyLicense, scanRepositoryRights, scanShippedAssets, type RightsSubject } from "../src/repository-rights-clearance.js";

test("rights classifier covers allow review deny and unknown", () => {
  assert.equal(classifyLicense("MIT"), "ALLOW");
  assert.equal(classifyLicense("MIT OR Apache-2.0"), "ALLOW");
  assert.equal(classifyLicense("MPL-2.0"), "REVIEW_REQUIRED");
  assert.equal(classifyLicense("PolyForm-Noncommercial-1.0.0"), "DENY");
  assert.equal(classifyLicense(null), "UNKNOWN");
});

test("active review waiver is explicit while expired waiver fails to change state", () => {
  const subject: RightsSubject = { id: "package:x@1", kind: "package", name: "x", versionOrIdentity: "1", licenseExpression: "MPL-2.0", state: "REVIEW_REQUIRED", evidence: ["package.json"], attributionRequired: true, distributed: true };
  const active = applyWaivers([subject], [{ subjectId: subject.id, owner: "ed3c", rationale: "reviewed boundary", scope: "runtime distribution", expiresAt: "2030-01-01T00:00:00.000Z" }], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(active.subjects[0]?.state, "ALLOW");
  assert.match(active.subjects[0]?.evidence.at(-1) ?? "", /^waiver:/);
  const expired = applyWaivers([subject], [{ subjectId: subject.id, owner: "ed3c", rationale: "expired", scope: "runtime", expiresAt: "2025-01-01T00:00:00.000Z" }], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(expired.subjects[0]?.state, "REVIEW_REQUIRED");
  assert.deepEqual(expired.expiredWaivers, [subject.id]);
});

test("repository-wide scan includes production dependencies from the shipped site workspace", async () => {
  const receipt = await scanRepositoryRights(process.cwd(), [], new Date("2026-08-18T00:00:00.000Z"));
  const ids = new Set(receipt.subjects.map((subject) => subject.id));
  for (const dependency of ["next@15.5.23", "react@19.2.8", "react-dom@19.2.8", "three@0.184.0", "pixi.js@8.19.0", "gsap@3.15.0", "motion@12.43.0", "@puckeditor/core@0.22.4", "@react-three/fiber@9.6.1"]) {
    assert.ok(ids.has(`package:${dependency}`), `missing site production dependency ${dependency}`);
  }
});

test("unmanifested or hash-mismatched public assets fail closed as UNKNOWN", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-rights-assets-"));
  try {
    const publicDirectory = join(root, "apps/site/public");
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(join(publicDirectory, "third-party.png"), "untrusted bytes");
    let subjects = await scanShippedAssets(root);
    assert.equal(subjects[0]?.state, "UNKNOWN");
    await writeFile(join(root, "rights-asset-evidence.json"), `${JSON.stringify({
      "apps/site/public/third-party.png": { sha256: "0".repeat(64), license: "MIT", source: "upstream license" }
    })}\n`);
    subjects = await scanShippedAssets(root);
    assert.equal(subjects[0]?.state, "UNKNOWN");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
