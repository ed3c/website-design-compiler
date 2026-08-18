import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyWaivers, classifyLicense, loadWaivers, scanShippedAssets, validateWaivers, type RightsSubject } from "../src/repository-rights-clearance.js";

test("rights classifier covers allow review deny and unknown", () => {
  assert.equal(classifyLicense("MIT"), "ALLOW");
  assert.equal(classifyLicense("MIT OR Apache-2.0"), "ALLOW");
  assert.equal(classifyLicense("MPL-2.0"), "REVIEW_REQUIRED");
  assert.equal(classifyLicense("PolyForm-Noncommercial-1.0.0"), "DENY");
  assert.equal(classifyLicense(null), "UNKNOWN");
});

test("active review waiver is explicit while expired waiver fails to change state", () => {
  const subject: RightsSubject = { id: "package:x@1", kind: "package", name: "x", versionOrIdentity: "1", licenseExpression: "MPL-2.0", state: "REVIEW_REQUIRED", evidence: ["package.json"], attributionRequired: true, distributed: true };
  const active = applyWaivers([subject], [{ subjectId: subject.id, owner: "ed3c", rationale: "reviewed boundary", scope: `subject:${subject.id}`, expiresAt: "2030-01-01T00:00:00.000Z" }], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(active.subjects[0]?.state, "ALLOW");
  assert.match(active.subjects[0]?.evidence.at(-1) ?? "", /^waiver:/);
  const expired = applyWaivers([subject], [{ subjectId: subject.id, owner: "ed3c", rationale: "expired waiver rationale", scope: `subject:${subject.id}`, expiresAt: "2025-01-01T00:00:00.000Z" }], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(expired.subjects[0]?.state, "REVIEW_REQUIRED");
  assert.deepEqual(expired.expiredWaivers, [subject.id]);
});

test("waiver contract binds owner rationale exact subject scope and canonical expiry", () => {
  const subjectId = "package:x@1";
  assert.throws(() => validateWaivers([{ subjectId, owner: "x", rationale: "too short", scope: "runtime", expiresAt: "2030-01-01" }]), /owner is invalid|unknown or missing fields/);
  assert.throws(() => validateWaivers([{ subjectId, owner: "ed3c", rationale: "a sufficiently clear reason", scope: "runtime", expiresAt: "2030-01-01T00:00:00.000Z" }]), /scope must bind/);
  assert.throws(() => validateWaivers([{ subjectId, owner: "ed3c", rationale: "a sufficiently clear reason", scope: `subject:${subjectId}`, expiresAt: "2030-01-01T00:00:00Z" }]), /canonical ISO/);
});

test("only an absent waiver file means no waivers; malformed JSON fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-rights-waiver-"));
  assert.deepEqual(await loadWaivers(join(root, "absent.json")), []);
  const malformedPath = join(root, "malformed.json");
  await writeFile(malformedPath, "{not-json", "utf8");
  await assert.rejects(loadWaivers(malformedPath), /invalid JSON/);
});

test("shipped assets require exact manifest coverage digest and governable license evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-rights-assets-"));
  const relativePath = "apps/site/public/hero.bin";
  const assetPath = join(root, relativePath);
  const bytes = new TextEncoder().encode("owned bytes require evidence");
  await mkdir(join(root, "apps/site/public"), { recursive: true });
  await writeFile(assetPath, bytes);
  const manifestPath = join(root, "rights-asset-provenance.json");
  const writeManifest = async (assets: unknown[]) => writeFile(manifestPath, `${JSON.stringify({ schema: "website-design-compiler/asset-provenance/v1", assets })}\n`, "utf8");
  await writeManifest([]);
  await assert.rejects(scanShippedAssets(root), /coverage mismatch/);
  const authoredSource = `git:${"a".repeat(40)}:${relativePath}`;
  await writeManifest([{ path: relativePath, sha256: createHash("sha256").update(bytes).digest("hex"), licenseExpression: "REPO_ORIGINAL", provenance: { kind: "AUTHORED", source: authoredSource }, attributionRequired: false }]);
  await assert.rejects(scanShippedAssets(root), /license is not governable/);
  const digest = createHash("sha256").update(bytes).digest("hex");
  await writeManifest([{ path: relativePath, sha256: digest, licenseExpression: "Apache-2.0", provenance: { kind: "AUTHORED", source: authoredSource }, attributionRequired: false }]);
  const subjects = await scanShippedAssets(root);
  assert.equal(subjects[0]?.state, "ALLOW");
  assert.equal(subjects[0]?.versionOrIdentity, `sha256:${digest}`);
});
