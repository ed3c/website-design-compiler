import assert from "node:assert/strict";
import test from "node:test";
import {
  createTechnologyAdmission,
  createTechnologyCandidate,
  createTechnologyRevocation,
  deriveEngineeringDecision,
  type RightsSubjectDecision
} from "../src/technology-admission.js";
import { validateAgainstSchema } from "../src/validate.js";

const h = (value: string) => value.repeat(64).slice(0, 64);
const sourceAnchor = { sourceIdentitySha256: h("a"), observationIdentitySha256: h("b") };

function packageCandidate() {
  return createTechnologyCandidate({
    subjectKind: "SOFTWARE_PACKAGE",
    lifecycle: "CANDIDATE",
    name: "synthetic parser candidate",
    runtimeRole: "parse PDF bytes into anchored text observations",
    optionality: "OPTIONAL",
    replacementTarget: null,
    capabilityJustification: "A PDF adapter needs a measured parser only after built-in capabilities are insufficient.",
    acceptanceCriteria: ["reject malformed bytes", "preserve page anchors", "deterministic extraction"],
    identity: {
      kind: "PACKAGE",
      packageName: "synthetic-parser",
      version: "1.2.3",
      registryUrl: "https://registry.example.test/synthetic-parser/-/synthetic-parser-1.2.3.tgz",
      distributionSha256: h("c")
    },
    licenseExpression: "MIT OR Apache-2.0",
    licenseTextSha256: h("d"),
    noticeRequired: true,
    attributionRequired: true,
    transitiveDependencyCount: 2,
    transitiveGraphSha256: h("e"),
    evidenceAnchors: [sourceAnchor]
  });
}

test("technology candidate binds exact package bytes, evidence, capability and rights metadata", async () => {
  const candidate = packageCandidate();
  assert.match(candidate.candidateId, /^tech-[a-f0-9]{20}$/);
  assert.equal(candidate.identity.kind, "PACKAGE");
  assert.equal(candidate.licenseExpression, "MIT OR Apache-2.0");
  assert.equal(candidate.lifecycle, "CANDIDATE");
  await validateAgainstSchema(candidate, "technology-candidate.schema.json");
});

test("candidate identity is deterministic under caller ordering but changes with exact version or distribution bytes", () => {
  const first = packageCandidate();
  const reordered = createTechnologyCandidate({
    subjectKind: "SOFTWARE_PACKAGE",
    lifecycle: "CANDIDATE",
    name: "synthetic parser candidate",
    runtimeRole: "parse PDF bytes into anchored text observations",
    optionality: "OPTIONAL",
    replacementTarget: null,
    capabilityJustification: "A PDF adapter needs a measured parser only after built-in capabilities are insufficient.",
    acceptanceCriteria: ["deterministic extraction", "preserve page anchors", "reject malformed bytes"],
    identity: {
      kind: "PACKAGE",
      packageName: "synthetic-parser",
      version: "1.2.3",
      registryUrl: "https://registry.example.test/synthetic-parser/-/synthetic-parser-1.2.3.tgz",
      distributionSha256: h("c")
    },
    licenseExpression: "MIT OR Apache-2.0",
    licenseTextSha256: h("d"),
    noticeRequired: true,
    attributionRequired: true,
    transitiveDependencyCount: 2,
    transitiveGraphSha256: h("e"),
    evidenceAnchors: [sourceAnchor]
  });
  const versionDrift = createTechnologyCandidate({
    ...packageCandidate(),
    identity: {
      kind: "PACKAGE",
      packageName: "synthetic-parser",
      version: "1.2.4",
      registryUrl: "https://registry.example.test/synthetic-parser/-/synthetic-parser-1.2.4.tgz",
      distributionSha256: h("f")
    }
  });

  assert.equal(first.candidateIdentitySha256, reordered.candidateIdentitySha256);
  assert.notEqual(first.candidateIdentitySha256, versionDrift.candidateIdentitySha256);
});

test("floating package identities and non-exact Git identities fail closed", () => {
  assert.throws(
    () => createTechnologyCandidate({ ...packageCandidate(), identity: { ...packageCandidate().identity as any, kind: "PACKAGE", packageName: "synthetic-parser", version: "^1.2.3", registryUrl: "https://registry.example.test/synthetic-parser.tgz", distributionSha256: h("c") } }),
    /version must be exact/
  );
  assert.throws(
    () => createTechnologyCandidate({ ...packageCandidate(), identity: { kind: "PACKAGE", packageName: "synthetic-parser", version: "latest", registryUrl: "https://registry.example.test/synthetic-parser.tgz", distributionSha256: h("c") } }),
    /version must be exact/
  );
  assert.throws(
    () => createTechnologyCandidate({ ...packageCandidate(), subjectKind: "GIT_REPOSITORY", identity: { kind: "GIT", repositoryUrl: "https://github.com/example/parser", commit: "main", tree: "b".repeat(40) } }),
    /40-character Git SHA/
  );
});

test("contract foundation preserves compound SPDX text without pretending to evaluate it", () => {
  const candidate = createTechnologyCandidate({
    ...packageCandidate(),
    licenseExpression: "GPL-2.0-only WITH Classpath-exception-2.0"
  });
  assert.equal(candidate.licenseExpression, "GPL-2.0-only WITH Classpath-exception-2.0");
  assert.equal(candidate.lifecycle, "CANDIDATE");
});

test("engineering admission keeps distinct rights subjects and derives fail-closed policy state", async () => {
  const candidate = packageCandidate();
  const rightsSubjects: RightsSubjectDecision[] = [
    { subjectId: "software-license", kind: "SOFTWARE_LICENSE", state: "ALLOW", evidenceSha256: h("1") },
    { subjectId: "hosted-service", kind: "HOSTED_SERVICE_TERMS", state: "NOT_APPLICABLE", evidenceSha256: h("2") },
    { subjectId: "model-weights", kind: "MODEL_WEIGHT_LICENSE", state: "REVIEW_REQUIRED", evidenceSha256: h("3") }
  ];
  const admission = createTechnologyAdmission({
    candidateIdentitySha256: candidate.candidateIdentitySha256,
    buildSubjectSha256: h("4"),
    rightsSubjects,
    evaluatedAt: "2026-08-19T00:00:00.000Z"
  });
  const sameSemanticAdmission = createTechnologyAdmission({
    candidateIdentitySha256: candidate.candidateIdentitySha256,
    buildSubjectSha256: h("4"),
    rightsSubjects: [...rightsSubjects].reverse(),
    evaluatedAt: "2026-08-19T01:00:00.000Z"
  });

  assert.equal(admission.decision, "REVIEW_REQUIRED");
  assert.equal(admission.authority, "ENGINEERING_POLICY");
  assert.equal(admission.legalDisclaimer, "ENGINEERING_ADMISSION_NOT_LEGAL_ADVICE");
  assert.equal(admission.admissionIdentitySha256, sameSemanticAdmission.admissionIdentitySha256);
  assert.deepEqual(admission.rightsSubjects.map((subject) => subject.subjectId), ["hosted-service", "model-weights", "software-license"]);
  await validateAgainstSchema(admission, "technology-admission.schema.json");
});

test("rights decision precedence is deny, unknown, review, allow and never collapses NOT_APPLICABLE-only evidence to allow", () => {
  const subject = (state: RightsSubjectDecision["state"]): RightsSubjectDecision => ({
    subjectId: state,
    kind: "SOFTWARE_LICENSE",
    state,
    evidenceSha256: h("9")
  });
  assert.equal(deriveEngineeringDecision([subject("ALLOW")]), "ALLOW");
  assert.equal(deriveEngineeringDecision([subject("ALLOW"), { ...subject("REVIEW_REQUIRED"), subjectId: "review" }]), "REVIEW_REQUIRED");
  assert.equal(deriveEngineeringDecision([subject("REVIEW_REQUIRED"), { ...subject("UNKNOWN"), subjectId: "unknown" }]), "UNKNOWN");
  assert.equal(deriveEngineeringDecision([subject("UNKNOWN"), { ...subject("DENY"), subjectId: "deny" }]), "DENY");
  assert.equal(deriveEngineeringDecision([subject("NOT_APPLICABLE")]), "UNKNOWN");
});

test("technology revocation binds prior admission and exact observed change without depending on timestamp", async () => {
  const candidate = packageCandidate();
  const admission = createTechnologyAdmission({
    candidateIdentitySha256: candidate.candidateIdentitySha256,
    buildSubjectSha256: h("4"),
    rightsSubjects: [{ subjectId: "software-license", kind: "SOFTWARE_LICENSE", state: "ALLOW", evidenceSha256: h("5") }],
    evaluatedAt: "2026-08-19T00:00:00.000Z"
  });
  const first = createTechnologyRevocation({
    candidateIdentitySha256: candidate.candidateIdentitySha256,
    admissionIdentitySha256: admission.admissionIdentitySha256,
    observedChangeSha256: h("6"),
    reason: "distribution bytes or terms changed",
    revokedAt: "2026-08-19T02:00:00.000Z"
  });
  const later = createTechnologyRevocation({ ...first, revokedAt: "2026-08-19T03:00:00.000Z" });

  assert.equal(first.revocationIdentitySha256, later.revocationIdentitySha256);
  await validateAgainstSchema(first, "technology-revocation.schema.json");
});

test("public evidence URLs reject credentials and query-bearing identities", () => {
  assert.throws(
    () => createTechnologyCandidate({ ...packageCandidate(), identity: { kind: "ARTIFACT", versionOrRevision: "v1", sourceUrl: "https://user:secret@example.test/model.bin", sourceSha256: h("7") } }),
    /must not contain credentials/
  );
  assert.throws(
    () => createTechnologyCandidate({ ...packageCandidate(), identity: { kind: "ARTIFACT", versionOrRevision: "v1", sourceUrl: "https://example.test/model.bin?token=x", sourceSha256: h("7") } }),
    /query or fragment/
  );
});
