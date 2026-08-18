import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyWaivers, classifyLicense, scanRepositoryRights, scanShippedAssets, type RightsSubject } from "../src/repository-rights-clearance.js";

test("rights classifier covers allow review deny and unknown", () => {
  assert.equal(classifyLicense("MIT"), "ALLOW");
  assert.equal(classifyLicense("MIT OR Apache-2.0"), "ALLOW");
  assert.equal(classifyLicense("MPL-2.0"), "REVIEW_REQUIRED");
  assert.equal(classifyLicense("Standard 'no charge' license: https://gsap.com/standard-license."), "REVIEW_REQUIRED");
  assert.equal(classifyLicense("PolyForm-Noncommercial-1.0.0"), "DENY");
  assert.equal(classifyLicense(null), "UNKNOWN");
});

test("active review waiver is explicit while expired waiver fails to change state", () => {
  const subject: RightsSubject = { id: "package:x@1", kind: "package", name: "x", versionOrIdentity: "1", licenseExpression: "MPL-2.0", state: "REVIEW_REQUIRED", evidence: ["package.json"], attributionRequired: false, distributed: true };
  const active = applyWaivers([subject], [{ subjectId: subject.id, owner: "ed3c", rationale: "reviewed boundary", scope: `subject:${subject.id}`, expiresAt: "2030-01-01T00:00:00.000Z" }], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(active.subjects[0]?.state, "ALLOW");
  assert.equal(active.subjects[0]?.attributionRequired, true, "a reviewed license must remain in the release NOTICE after Human Admit");
  assert.match(active.subjects[0]?.evidence.at(-1) ?? "", /^waiver:/);
  assert.deepEqual(active.diagnostics, []);
  const expired = applyWaivers([subject], [{ subjectId: subject.id, owner: "ed3c", rationale: "expired", scope: `subject:${subject.id}`, expiresAt: "2025-01-01T00:00:00.000Z" }], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(expired.subjects[0]?.state, "REVIEW_REQUIRED");
  assert.deepEqual(expired.expiredWaivers, [subject.id]);
  assert.deepEqual(expired.diagnostics, []);
});

test("invalid review waivers stay non-ALLOW and produce diagnostics", () => {
  const subject: RightsSubject = { id: "package:x@1", kind: "package", name: "x", versionOrIdentity: "1", licenseExpression: "LGPL-3.0", state: "REVIEW_REQUIRED", evidence: ["package.json"], attributionRequired: true, distributed: true };
  const valid = { subjectId: subject.id, owner: "ed3c", rationale: "reviewed boundary", scope: `subject:${subject.id}`, expiresAt: "2030-01-01T00:00:00.000Z" };
  const invalidWaivers = [
    { ...valid, subjectId: "" },
    { ...valid, owner: "" },
    { ...valid, rationale: "" },
    { ...valid, scope: "" },
    { ...valid, scope: "runtime distribution" },
    { ...valid, expiresAt: "" },
    { ...valid, expiresAt: "not-a-date" }
  ];
  for (const waiver of invalidWaivers) {
    const result = applyWaivers([subject], [waiver], new Date("2026-08-17T00:00:00.000Z"));
    assert.equal(result.subjects[0]?.state, "REVIEW_REQUIRED");
    assert.equal(result.diagnostics.length, 1);
    assert.deepEqual(result.expiredWaivers, []);
  }
});

test("malformed runtime waiver shapes produce diagnostics instead of throwing", () => {
  const subject: RightsSubject = { id: "package:x@1", kind: "package", name: "x", versionOrIdentity: "1", licenseExpression: "LGPL-3.0", state: "REVIEW_REQUIRED", evidence: ["package.json"], attributionRequired: true, distributed: true };
  const malformedEntry = applyWaivers([subject], [null] as unknown as Parameters<typeof applyWaivers>[1], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(malformedEntry.subjects[0]?.state, "REVIEW_REQUIRED");
  assert.deepEqual(malformedEntry.diagnostics, ["waiver:0:INVALID_SHAPE"]);
  const malformedCollection = applyWaivers([subject], {} as Parameters<typeof applyWaivers>[1], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(malformedCollection.subjects[0]?.state, "REVIEW_REQUIRED");
  assert.deepEqual(malformedCollection.diagnostics, ["waivers:INVALID_COLLECTION"]);
});

test("a conflicting invalid or expired waiver prevents admission of the same subject", () => {
  const subject: RightsSubject = { id: "package:x@1", kind: "package", name: "x", versionOrIdentity: "1", licenseExpression: "LGPL-3.0", state: "REVIEW_REQUIRED", evidence: ["package.json"], attributionRequired: true, distributed: true };
  const active = { subjectId: subject.id, owner: "ed3c", rationale: "reviewed boundary", scope: `subject:${subject.id}`, expiresAt: "2030-01-01T00:00:00.000Z" };
  const invalid = { ...active, scope: "runtime distribution" };
  const expired = { ...active, expiresAt: "2025-01-01T00:00:00.000Z" };
  const invalidResult = applyWaivers([subject], [active, invalid], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(invalidResult.subjects[0]?.state, "REVIEW_REQUIRED");
  assert.equal(invalidResult.diagnostics.length, 1);
  const expiredResult = applyWaivers([subject], [active, expired], new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(expiredResult.subjects[0]?.state, "REVIEW_REQUIRED");
  assert.deepEqual(expiredResult.expiredWaivers, [subject.id]);
});

test("repository-wide scan includes production dependencies from the shipped site workspace", async () => {
  const receipt = await scanRepositoryRights(process.cwd(), [], new Date("2026-08-18T00:00:00.000Z"));
  const ids = new Set(receipt.subjects.map((subject) => subject.id));
  for (const dependency of ["next@15.5.23", "react@19.2.8", "react-dom@19.2.8", "three@0.184.0", "pixi.js@8.19.0", "gsap@3.15.0", "motion@12.43.0", "@puckeditor/core@0.22.4", "@react-three/fiber@9.6.1"]) {
    assert.ok(ids.has(`package:${dependency}`), `missing site production dependency ${dependency}`);
  }
  assert.equal(receipt.overall, "FAIL");
  assert.deepEqual(receipt.unresolved, ["package:@img/sharp-libvips-darwin-arm64@1.2.4", "package:caniuse-lite@1.0.30001809", "package:gsap@3.15.0"]);
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

test("public asset symlinks fail closed without following their targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-rights-symlink-"));
  try {
    const publicDirectory = join(root, "apps/site/public");
    await mkdir(publicDirectory, { recursive: true });
    const outsideTarget = join(root, "untracked-third-party.png");
    await writeFile(outsideTarget, "unknown third-party bytes", "utf8");
    await symlink(outsideTarget, join(publicDirectory, "linked-third-party.png"));
    await writeFile(join(root, "rights-asset-provenance.json"), `${JSON.stringify({
      schema: "website-design-compiler/asset-provenance/v1",
      assets: []
    })}\n`, "utf8");

    const subjects = await scanShippedAssets(root);
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0]?.id, "asset:apps/site/public/linked-third-party.png");
    assert.equal(subjects[0]?.state, "UNKNOWN");
    assert.equal(subjects[0]?.distributed, true);
    assert.equal(subjects[0]?.versionOrIdentity, "SYMLINK_NOT_ADMITTED");
    assert.match(subjects[0]?.evidence.join(" ") ?? "", /SYMLINK_NOT_ADMITTED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("absent public tree means zero assets while an unreadable tree is diagnostic UNKNOWN", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-rights-public-tree-"));
  try {
    assert.deepEqual(await scanShippedAssets(root), []);
    await mkdir(join(root, "apps/site"), { recursive: true });
    await writeFile(join(root, "rights-asset-provenance.json"), `${JSON.stringify({
      schema: "website-design-compiler/asset-provenance/v1",
      assets: []
    })}\n`, "utf8");
    await writeFile(join(root, "apps/site/public"), "not a directory", "utf8");
    const subjects = await scanShippedAssets(root);
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0]?.state, "UNKNOWN");
    assert.equal(subjects[0]?.distributed, true);
    assert.match(subjects[0]?.evidence.join(" ") ?? "", /diagnostic:public-tree:ENOTDIR/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("package metadata read or parse failures are UNKNOWN instead of NOT_DISTRIBUTED", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-rights-package-metadata-"));
  const packageDirectory = join(root, "node_modules/.pnpm/broken@1.0.0/node_modules/broken");
  const packageManifest = join(packageDirectory, "package.json");
  const binDirectory = join(root, "bin");
  const previousPath = process.env.PATH;
  try {
    await mkdir(packageDirectory, { recursive: true });
    await mkdir(join(root, "apps/site/public"), { recursive: true });
    await mkdir(binDirectory);
    const pnpmPath = join(binDirectory, "pnpm");
    await writeFile(pnpmPath, "#!/bin/sh\nprintf '%s\\n' '[{\"dependencies\":{\"broken\":{\"version\":\"1.0.0\"}}}]'\n", "utf8");
    await chmod(pnpmPath, 0o755);
    process.env.PATH = `${binDirectory}:${previousPath ?? ""}`;

    for (const metadata of [
      { contents: "{not-json", diagnostic: "INVALID_JSON" },
      { contents: null, diagnostic: "ENOENT" }
    ] as const) {
      if (metadata.contents === null) await rm(packageManifest, { force: true });
      else await writeFile(packageManifest, metadata.contents, "utf8");
      const receipt = await scanRepositoryRights(root, [], new Date("2026-08-18T00:00:00.000Z"));
      const subject = receipt.subjects.find((candidate) => candidate.id === "package:broken@1.0.0");
      assert.equal(subject?.state, "UNKNOWN");
      assert.equal(subject?.distributed, true);
      assert.match(subject?.evidence.join(" ") ?? "", new RegExp(`diagnostic:package-metadata:${metadata.diagnostic}`));
      assert.equal(receipt.overall, "FAIL");
      assert.ok(receipt.unresolved.includes("package:broken@1.0.0"));
      assert.ok(receipt.diagnostics.some((diagnostic) => diagnostic.includes(`package-metadata:${metadata.diagnostic}`)));
    }
  } finally {
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("a production-graph package with an explicit absent release-target path is not distributed", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-rights-optional-target-"));
  const binDirectory = join(root, "bin");
  const previousPath = process.env.PATH;
  try {
    await mkdir(join(root, "node_modules/.pnpm"), { recursive: true });
    const stale = join(root, "node_modules/.pnpm/platform-only@1.0.0_stale/node_modules/platform-only");
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, "package.json"), `${JSON.stringify({ name: "platform-only", version: "1.0.0", license: "MIT" })}\n`, "utf8");
    await mkdir(binDirectory);
    const missingTarget = join(root, "node_modules/.pnpm/platform-only@1.0.0/node_modules/platform-only");
    const graph = JSON.stringify([{ dependencies: { "platform-only": { version: "1.0.0", path: missingTarget } } }]);
    const pnpmPath = join(binDirectory, "pnpm");
    await writeFile(pnpmPath, `#!/bin/sh\nprintf '%s\\n' '${graph}'\n`, "utf8");
    await chmod(pnpmPath, 0o755);
    process.env.PATH = `${binDirectory}:${previousPath ?? ""}`;

    const receipt = await scanRepositoryRights(root, [], new Date("2026-08-18T00:00:00.000Z"));
    const subject = receipt.subjects.find((candidate) => candidate.id === "package:platform-only@1.0.0");
    assert.equal(subject?.state, "NOT_DISTRIBUTED");
    assert.equal(subject?.distributed, false);
    assert.equal(receipt.unresolved.includes("package:platform-only@1.0.0"), false);
  } finally {
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("the exact production graph install path wins over a stale pnpm store copy", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-rights-exact-target-"));
  const binDirectory = join(root, "bin");
  const previousPath = process.env.PATH;
  try {
    const target = join(root, "release-target/node_modules/example");
    const stale = join(root, "node_modules/.pnpm/example@1.0.0/node_modules/example");
    await mkdir(target, { recursive: true });
    await mkdir(stale, { recursive: true });
    await mkdir(binDirectory);
    await writeFile(join(target, "package.json"), `${JSON.stringify({ name: "example", version: "1.0.0", license: "PolyForm-Noncommercial-1.0.0" })}\n`, "utf8");
    await writeFile(join(stale, "package.json"), `${JSON.stringify({ name: "example", version: "1.0.0", license: "MIT" })}\n`, "utf8");
    const graph = JSON.stringify([{ dependencies: { example: { version: "1.0.0", path: target } } }]);
    const pnpmPath = join(binDirectory, "pnpm");
    await writeFile(pnpmPath, `#!/bin/sh\nprintf '%s\\n' '${graph}'\n`, "utf8");
    await chmod(pnpmPath, 0o755);
    process.env.PATH = `${binDirectory}:${previousPath ?? ""}`;

    const receipt = await scanRepositoryRights(root, [], new Date("2026-08-18T00:00:00.000Z"));
    const subject = receipt.subjects.find((candidate) => candidate.id === "package:example@1.0.0");
    assert.equal(subject?.licenseExpression, "PolyForm-Noncommercial-1.0.0");
    assert.equal(subject?.state, "DENY");
    assert.equal(receipt.overall, "FAIL");
  } finally {
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("waiver and public-tree diagnostics independently fail the repository receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-rights-receipt-diagnostics-"));
  const binDirectory = join(root, "bin");
  const publicDirectory = join(root, "apps/site/public");
  const previousPath = process.env.PATH;
  try {
    await mkdir(join(root, "node_modules/.pnpm"), { recursive: true });
    await mkdir(publicDirectory, { recursive: true });
    await mkdir(binDirectory);
    await writeFile(join(root, "rights-asset-provenance.json"), `${JSON.stringify({
      schema: "website-design-compiler/asset-provenance/v1",
      assets: []
    })}\n`, "utf8");
    const pnpmPath = join(binDirectory, "pnpm");
    await writeFile(pnpmPath, "#!/bin/sh\nprintf '%s\\n' '[]'\n", "utf8");
    await chmod(pnpmPath, 0o755);
    process.env.PATH = `${binDirectory}:${previousPath ?? ""}`;

    const invalidWaiverReceipt = await scanRepositoryRights(root, [{ subjectId: "model:internal-deterministic-mock", owner: "", rationale: "reviewed boundary", scope: "subject:model:internal-deterministic-mock", expiresAt: "2030-01-01T00:00:00.000Z" }], new Date("2026-08-18T00:00:00.000Z"));
    assert.equal(invalidWaiverReceipt.overall, "FAIL");
    assert.deepEqual(invalidWaiverReceipt.unresolved, []);
    assert.match(invalidWaiverReceipt.diagnostics.join(" "), /waiver:0:owner:EMPTY/);

    await rm(publicDirectory, { recursive: true });
    const absentPublicTreeReceipt = await scanRepositoryRights(root, [], new Date("2026-08-18T00:00:00.000Z"));
    assert.equal(absentPublicTreeReceipt.overall, "PASS");
    assert.deepEqual(absentPublicTreeReceipt.diagnostics, []);

    await writeFile(publicDirectory, "not a directory", "utf8");
    const publicTreeReceipt = await scanRepositoryRights(root, [], new Date("2026-08-18T00:00:00.000Z"));
    assert.equal(publicTreeReceipt.overall, "FAIL");
    assert.ok(publicTreeReceipt.unresolved.includes("asset-scan:apps/site/public"));
    assert.match(publicTreeReceipt.diagnostics.join(" "), /diagnostic:public-tree:ENOTDIR/);
  } finally {
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});
