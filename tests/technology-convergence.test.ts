import assert from "node:assert/strict";
import test from "node:test";
import { createSbomNoticeEvidence } from "../src/sbom-notice.js";
import { createTechnologyCandidate } from "../src/technology-admission.js";
import { createConvergedTechnologyAdmission, createConvergedTechnologyRevocation } from "../src/technology-convergence.js";
import { validateAgainstSchema } from "../src/validate.js";

const g = (value: string) => value.repeat(40).slice(0, 40);
const h = (value: string) => value.repeat(64).slice(0, 64);

function candidate(licenseExpression = "MIT") {
  return createTechnologyCandidate({
    subjectKind: "SOFTWARE_PACKAGE",
    lifecycle: "CANDIDATE",
    name: "alpha",
    runtimeRole: "parser dependency",
    optionality: "CORE",
    replacementTarget: null,
    capabilityJustification: "exact parser capability",
    acceptanceCriteria: ["exact package artifact is rights-cleared"],
    identity: {
      kind: "PACKAGE",
      packageName: "alpha",
      version: "1.2.3",
      registryUrl: "https://registry.npmjs.org/alpha",
      distributionSha256: h("b")
    },
    licenseExpression,
    licenseTextSha256: h("d"),
    noticeRequired: true,
    attributionRequired: true,
    transitiveDependencyCount: 0,
    transitiveGraphSha256: h("2"),
    evidenceAnchors: [{ sourceIdentitySha256: h("3"), observationIdentitySha256: h("4") }]
  });
}

function sbom(licenseExpression = "MIT", noticeTextSha256: string | null = h("e")) {
  return createSbomNoticeEvidence({
    repositoryTree: g("a"),
    lockfileSha256: h("1"),
    productionGraphSha256: h("2"),
    packages: [{
      name: "alpha",
      version: "1.2.3",
      artifactSha256: h("b"),
      distributed: true,
      metadataState: "COMPLETE",
      metadataDiagnostic: null,
      licenseExpression,
      licenseTextSha256: h("d"),
      attributionRequired: true,
      noticeTextSha256,
      admissionIdentitySha256: h("f")
    }],
    generatedAt: "2026-08-19T00:00:00.000Z"
  });
}

test("exact-build SPDX and SBOM evidence converge into engineering admission while legal state stays separate", async () => {
  const result = createConvergedTechnologyAdmission(candidate(), sbom(), "2026-08-19T01:00:00.000Z");
  assert.equal(result.spdx.state, "ALLOW");
  assert.equal(result.admission.decision, "ALLOW");
  assert.equal(result.receipt.engineeringDecision, "ALLOW");
  assert.equal(result.receipt.humanLegalState, "NOT_EVALUATED");
  assert.equal(result.admission.buildSubjectSha256, result.receipt.buildSubjectSha256);
  await validateAgainstSchema(result.receipt, "technology-convergence-receipt.schema.json");
});

test("copyleft policy remains REVIEW_REQUIRED and cannot be promoted by complete notice evidence", () => {
  const result = createConvergedTechnologyAdmission(
    candidate("GPL-3.0-only"),
    sbom("GPL-3.0-only"),
    "2026-08-19T01:00:00.000Z"
  );
  assert.equal(result.spdx.state, "REVIEW_REQUIRED");
  assert.equal(result.admission.decision, "REVIEW_REQUIRED");
  assert.equal(result.receipt.humanLegalState, "NOT_EVALUATED");
});

test("candidate and SBOM license drift fails closed", () => {
  assert.throws(
    () => createConvergedTechnologyAdmission(candidate("MIT"), sbom("Apache-2.0"), "2026-08-19T01:00:00.000Z"),
    /license expressions drifted/
  );
});

test("incomplete SBOM notice evidence cannot enter convergence", () => {
  const failed = sbom("MIT", null);
  assert.equal(failed.overall, "FAIL");
  assert.throws(
    () => createConvergedTechnologyAdmission(candidate(), failed, "2026-08-19T01:00:00.000Z"),
    /must PASS before technology convergence/
  );
});

test("artifact identity drift cannot match a different exact package subject", () => {
  const changed = createTechnologyCandidate({
    ...candidate(),
    identity: {
      kind: "PACKAGE",
      packageName: "alpha",
      version: "1.2.3",
      registryUrl: "https://registry.npmjs.org/alpha",
      distributionSha256: h("9")
    }
  });
  assert.throws(
    () => createConvergedTechnologyAdmission(changed, sbom(), "2026-08-19T01:00:00.000Z"),
    /does not contain the candidate exact package/
  );
});

test("converged revocation binds the exact candidate and admission identities", () => {
  const result = createConvergedTechnologyAdmission(candidate(), sbom(), "2026-08-19T01:00:00.000Z");
  const revocation = createConvergedTechnologyRevocation(
    result.receipt,
    h("8"),
    "upstream rights subject changed",
    "2026-08-19T02:00:00.000Z"
  );
  assert.equal(revocation.candidateIdentitySha256, result.receipt.candidateIdentitySha256);
  assert.equal(revocation.admissionIdentitySha256, result.receipt.admissionIdentitySha256);
  assert.equal(revocation.observedChangeSha256, h("8"));
});
