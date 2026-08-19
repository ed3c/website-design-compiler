import assert from "node:assert/strict";
import test from "node:test";
import { createSbomNoticeEvidence, type BuildPackageSubject } from "../src/sbom-notice.js";
import { validateAgainstSchema } from "../src/validate.js";

const h = (value: string) => value.repeat(64).slice(0, 64);
const tree = "a".repeat(40);

function completePackage(name = "alpha", version = "1.2.3"): BuildPackageSubject {
  return {
    name,
    version,
    artifactSha256: h(name === "alpha" ? "b" : "c"),
    distributed: true,
    metadataState: "COMPLETE",
    metadataDiagnostic: null,
    licenseExpression: "MIT",
    licenseTextSha256: h("d"),
    attributionRequired: true,
    noticeTextSha256: h("e"),
    admissionIdentitySha256: h("f")
  };
}

function baseInput() {
  return {
    repositoryTree: tree,
    lockfileSha256: h("1"),
    productionGraphSha256: h("2"),
    packages: [completePackage("alpha"), completePackage("beta", "2.0.0")],
    generatedAt: "2026-08-19T00:00:00.000Z"
  };
}

test("complete exact-build subjects produce deterministic PASS SBOM and notice evidence", async () => {
  const first = createSbomNoticeEvidence(baseInput());
  const reordered = createSbomNoticeEvidence({ ...baseInput(), packages: [...baseInput().packages].reverse(), generatedAt: "2026-08-19T01:00:00.000Z" });
  assert.equal(first.overall, "PASS");
  assert.equal(first.blockingDiagnostics.length, 0);
  assert.equal(first.components.length, 2);
  assert.equal(first.noticeSubjects.length, 2);
  assert.equal(first.buildSubjectSha256, reordered.buildSubjectSha256);
  assert.equal(first.evidenceIdentitySha256, reordered.evidenceIdentitySha256);
  assert.deepEqual(first.components.map((component) => component.name), ["alpha", "beta"]);
  await validateAgainstSchema(first, "sbom-notice-evidence.schema.json");
});

test("missing license evidence and admission identity remain explicit FAIL instead of ALLOW", () => {
  const result = createSbomNoticeEvidence({
    ...baseInput(),
    packages: [{
      ...completePackage(),
      licenseExpression: null,
      licenseTextSha256: null,
      admissionIdentitySha256: null
    }]
  });
  assert.equal(result.overall, "FAIL");
  assert.equal(result.components[0]!.evidenceState, "INCOMPLETE");
  assert.match(result.blockingDiagnostics.join("; "), /license expression evidence is absent/);
  assert.match(result.blockingDiagnostics.join("; "), /license text digest is absent/);
  assert.match(result.blockingDiagnostics.join("; "), /technology admission identity is absent/);
});

test("metadata failures stay explicit and must carry a diagnostic", () => {
  const result = createSbomNoticeEvidence({
    ...baseInput(),
    packages: [{ ...completePackage(), metadataState: "READ_ERROR", metadataDiagnostic: "EACCES" }]
  });
  assert.equal(result.overall, "FAIL");
  assert.match(result.blockingDiagnostics.join("; "), /READ_ERROR: EACCES/);

  assert.throws(
    () => createSbomNoticeEvidence({ ...baseInput(), packages: [{ ...completePackage(), metadataState: "PARSE_ERROR", metadataDiagnostic: null }] }),
    /incomplete metadata requires a diagnostic/
  );
  assert.throws(
    () => createSbomNoticeEvidence({ ...baseInput(), packages: [{ ...completePackage(), metadataState: "COMPLETE", metadataDiagnostic: "stale" }] }),
    /COMPLETE metadata cannot carry a diagnostic/
  );
});

test("required attribution without exact notice bytes blocks evidence", () => {
  const result = createSbomNoticeEvidence({ ...baseInput(), packages: [{ ...completePackage(), noticeTextSha256: null }] });
  assert.equal(result.overall, "FAIL");
  assert.equal(result.noticeSubjects.length, 0);
  assert.match(result.blockingDiagnostics.join("; "), /notice text digest is absent/);
});

test("non-distributed packages are preserved but do not manufacture distributed obligations", () => {
  const result = createSbomNoticeEvidence({
    ...baseInput(),
    packages: [{
      ...completePackage(),
      distributed: false,
      metadataState: "MISSING",
      metadataDiagnostic: "release target excludes this package",
      licenseExpression: null,
      licenseTextSha256: null,
      noticeTextSha256: null,
      admissionIdentitySha256: null
    }]
  });
  assert.equal(result.overall, "PASS");
  assert.equal(result.components[0]!.evidenceState, "NOT_DISTRIBUTED");
  assert.equal(result.noticeSubjects.length, 0);
});

test("floating versions, malformed hashes, abbreviated tree identities and duplicate exact subjects fail closed", () => {
  assert.throws(() => createSbomNoticeEvidence({ ...baseInput(), packages: [{ ...completePackage(), version: "^1.2.3" }] }), /version must be an exact/);
  assert.throws(() => createSbomNoticeEvidence({ ...baseInput(), packages: [{ ...completePackage(), version: "latest" }] }), /version must be an exact/);
  assert.throws(() => createSbomNoticeEvidence({ ...baseInput(), repositoryTree: "abc1234" }), /40-character Git tree SHA/);
  assert.throws(() => createSbomNoticeEvidence({ ...baseInput(), lockfileSha256: "bad" }), /exact SHA-256/);
  assert.throws(() => createSbomNoticeEvidence({ ...baseInput(), packages: [completePackage(), completePackage()] }), /duplicate exact package subject/);
});

test("lock graph or exact artifact drift changes build identity", () => {
  const original = createSbomNoticeEvidence(baseInput());
  const lockDrift = createSbomNoticeEvidence({ ...baseInput(), lockfileSha256: h("3") });
  const artifactDrift = createSbomNoticeEvidence({
    ...baseInput(),
    packages: [{ ...completePackage(), artifactSha256: h("4") }]
  });
  assert.notEqual(original.buildSubjectSha256, lockDrift.buildSubjectSha256);
  assert.notEqual(original.buildSubjectSha256, artifactDrift.buildSubjectSha256);
});
