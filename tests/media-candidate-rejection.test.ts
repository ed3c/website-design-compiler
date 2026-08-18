import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildMediaCandidateRejectionReceipt } from "../src/media-candidate-rejection.js";
import { validateAgainstSchema } from "../src/validate.js";

const git = {
  sha: "a".repeat(40),
  tree: "b".repeat(40),
  ref: "refs/heads/candidate-rejection"
};

async function fixtureRoot(admission: "DENY" | "REVIEW_REQUIRED" = "DENY"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wdc-media-reject-"));
  await mkdir(join(root, "fixtures", "media"), { recursive: true });
  await writeFile(join(root, "fixtures", "media", "model-policy.json"), `${JSON.stringify({
    schema: "website-design-compiler/media-model-policy/v1",
    productCoreForbiddenImports: ["WanGP"],
    entries: [{
      id: "rejected-video",
      kind: "video",
      adapter: "diffusers-video",
      admission,
      versionOrCommit: "0123456789abcdef0123456789abcdef01234567",
      provenanceSubjectId: "model:rejected-video",
      outputTermsSubjectId: "generated-output:rejected-video",
      serviceTermsSubjectId: "service:local-video"
    }]
  }, null, 2)}\n`, "utf8");
  const source = {
    url: "https://provider.example/model/LICENSE",
    sha256: "c".repeat(64),
    bytes: 128,
    verifiedAt: "2026-08-19T00:00:00.000Z"
  };
  await writeFile(join(root, "rights-production-evidence.json"), `${JSON.stringify({
    schema: "website-design-compiler/production-rights-evidence/v1",
    subjects: [
      { id: "model:rejected-video", kind: "model", name: "Rejected video", versionOrIdentity: "hf:model@0123456789abcdef0123456789abcdef01234567", licenseExpression: "LicenseRef-NON-COMMERCIAL", evidence: [source], attributionRequired: true, distributed: false, geographicRestrictions: [], usageRestrictions: ["PRODUCTION_USE_EXCLUDED"] },
      { id: "generated-output:rejected-video", kind: "generated-output", name: "Rejected video output", versionOrIdentity: "local:model@0123456789abcdef0123456789abcdef01234567", licenseExpression: "NOASSERTION", evidence: [source], attributionRequired: false, distributed: false, geographicRestrictions: [], usageRestrictions: ["OUTPUT_RIGHTS_UNPROVEN"] },
      { id: "service:local-video", kind: "service", name: "Local video", versionOrIdentity: "local:model@0123456789abcdef0123456789abcdef01234567", licenseExpression: "NOASSERTION", evidence: [source], attributionRequired: false, distributed: false, geographicRestrictions: [], usageRestrictions: ["NO_HOSTED_SERVICE"] }
    ]
  }, null, 2)}\n`, "utf8");
  return root;
}

test("a denied media candidate produces an evidence-bound rejection without calling its worker", async () => {
  const root = await fixtureRoot();
  const receipt = await buildMediaCandidateRejectionReceipt(root, git, new Date("2026-08-19T00:01:00.000Z"));

  assert.equal(receipt.overall, "PASS");
  assert.equal(receipt.decision, "REJECT");
  assert.equal(receipt.candidates.length, 1);
  assert.equal(receipt.candidates[0]?.routing.workerCalls, 0);
  assert.equal(receipt.candidates[0]?.routing.overall, "FAIL");
  assert.match(receipt.candidates[0]?.routing.reason ?? "", /DENY/);
  assert.equal(receipt.candidates[0]?.rights.model.state, "DENY");
  assert.equal(receipt.candidates[0]?.rights.output.state, "UNKNOWN");
  assert.equal(receipt.candidates[0]?.rights.service.state, "UNKNOWN");
  await validateAgainstSchema(receipt, "media-candidate-rejection.schema.json");
});

test("a candidate cannot be called rejected while its policy is still review-required", async () => {
  const root = await fixtureRoot("REVIEW_REQUIRED");
  await assert.rejects(
    buildMediaCandidateRejectionReceipt(root, git, new Date("2026-08-19T00:01:00.000Z")),
    /no denied production media candidates/
  );
});

test("repository policy pins evidence-backed video and 3d rejections", async () => {
  const receipt = await buildMediaCandidateRejectionReceipt(process.cwd(), git, new Date("2026-08-19T00:01:00.000Z"));
  assert.deepEqual(
    receipt.candidates.map((candidate) => [candidate.kind, candidate.modelId, candidate.versionOrCommit]),
    [
      ["video", "stabilityai-svd-1.1-tensorrt", "32eaa3e7d521d402740f134d3390c9697fb99f3e"],
      ["3d", "facebook-vfusion3d", "0aeeaaca12806a10d7ba326992f84b0922f41188"]
    ]
  );
  assert.ok(receipt.candidates.every((candidate) => candidate.sources.every((source) => source.bytes > 0)));
  assert.ok(receipt.candidates.every((candidate) => candidate.routing.workerCalls === 0));
});
