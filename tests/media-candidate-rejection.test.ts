import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

async function fixtureRoot(admission: "DENY" | "REVIEW_REQUIRED" = "DENY"): Promise<{root:string;trustedSha256:string}> {
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
      serviceTermsSubjectId: "service:local-video",
      productionIdentity: {
        providerId: "local-video",
        serviceRevision: "commit:0123456789abcdef0123456789abcdef01234567",
        modelRevision: "commit:0123456789abcdef0123456789abcdef01234567"
      }
    }]
  }, null, 2)}\n`, "utf8");
  const source = {
    url: "https://provider.example/model/LICENSE",
    sha256: "c".repeat(64),
    bytes: 128,
    verifiedAt: "2026-08-19T00:00:00.000Z"
  };
  await writeFile(join(root, "rights-production-evidence.json"), `${JSON.stringify({
    schema: "website-design-compiler/production-rights-evidence/v2",
    subjects: [
      { id: "model:rejected-video", kind: "model", name: "Rejected video", sourceRevision: "0123456789abcdef0123456789abcdef01234567", versionOrIdentity: "commit:0123456789abcdef0123456789abcdef01234567", licenseExpression: "LicenseRef-NON-COMMERCIAL", evidence: [source], attributionRequired: true, distributed: false, geographicRestrictions: [], usageRestrictions: ["PRODUCTION_USE_EXCLUDED"] },
      { id: "generated-output:rejected-video", kind: "generated-output", name: "Rejected video output", sourceRevision: "0123456789abcdef0123456789abcdef01234567", versionOrIdentity: "local-video@commit:0123456789abcdef0123456789abcdef01234567/rejected-video@commit:0123456789abcdef0123456789abcdef01234567", licenseExpression: "NOASSERTION", evidence: [source], attributionRequired: false, distributed: false, geographicRestrictions: [], usageRestrictions: ["OUTPUT_RIGHTS_UNPROVEN"] },
      { id: "service:local-video", kind: "service", name: "Local video", sourceRevision: "0123456789abcdef0123456789abcdef01234567", versionOrIdentity: "local-video@commit:0123456789abcdef0123456789abcdef01234567", licenseExpression: "NOASSERTION", evidence: [source], attributionRequired: false, distributed: false, geographicRestrictions: [], usageRestrictions: ["NO_HOSTED_SERVICE"] }
    ]
  }, null, 2)}\n`, "utf8");
  const bytes=await readFile(join(root,"rights-production-evidence.json"));
  return {root,trustedSha256:createHash("sha256").update(bytes).digest("hex")};
}

test("a denied media candidate uses the formal production route without calling its transport", async () => {
  const {root,trustedSha256} = await fixtureRoot();
  const receipt = await buildMediaCandidateRejectionReceipt(root, git, new Date("2026-08-19T00:01:00.000Z"),trustedSha256,git.tree);

  assert.equal(receipt.overall, "PASS");
  assert.equal(receipt.decision, "REJECT");
  assert.equal(receipt.candidates.length, 1);
  assert.equal(receipt.evidenceAdmission.state,"PASS");
  assert.equal(receipt.evidenceAdmission.observedSha256,trustedSha256);
  assert.equal(receipt.candidates[0]?.routing.route,"PRODUCTION_PROVIDER");
  assert.equal(receipt.candidates[0]?.routing.transportCalls, 0);
  assert.equal(receipt.candidates[0]?.routing.overall, "NOT_EXERCISED");
  assert.equal(receipt.candidates[0]?.routing.admissionState,"DENIED");
  assert.match(receipt.candidates[0]?.routing.reason ?? "", /rights state is DENY/);
  assert.equal(receipt.candidates[0]?.rights.model.state, "DENY");
  assert.equal(receipt.candidates[0]?.rights.output.state, "UNKNOWN");
  assert.equal(receipt.candidates[0]?.rights.service.state, "UNKNOWN");
  await validateAgainstSchema(receipt, "media-candidate-rejection.schema.json");
});

test("a candidate cannot be called rejected while its policy is still review-required", async () => {
  const {root,trustedSha256} = await fixtureRoot("REVIEW_REQUIRED");
  await assert.rejects(
    buildMediaCandidateRejectionReceipt(root, git, new Date("2026-08-19T00:01:00.000Z"),trustedSha256,git.tree),
    /no denied production media candidates/
  );
});

test("candidate evidence without an external trusted digest cannot become PASS",async()=>{
  const {root,trustedSha256}=await fixtureRoot();
  const absent=await buildMediaCandidateRejectionReceipt(root,git,new Date("2026-08-19T00:01:00.000Z"));
  assert.equal(absent.overall,"NOT_EXERCISED");
  assert.equal(absent.evidenceAdmission.state,"NOT_EXERCISED");
  await assert.rejects(
    buildMediaCandidateRejectionReceipt(root,git,new Date("2026-08-19T00:01:00.000Z"),trustedSha256),
    /requires both rights evidence SHA-256 and Git tree/
  );
  await assert.rejects(
    buildMediaCandidateRejectionReceipt(root,git,new Date("2026-08-19T00:01:00.000Z"),trustedSha256,"c".repeat(40)),
    /does not match the externally trusted Git tree/
  );
  await assert.rejects(
    buildMediaCandidateRejectionReceipt(root,git,new Date("2026-08-19T00:01:00.000Z"),trustedSha256.replace(/^./,"f"),git.tree),
    /externally trusted SHA-256/
  );
});

test("policy and all rights subjects must bind the same exact source revision",async()=>{
  const {root,trustedSha256}=await fixtureRoot();
  const path=join(root,"rights-production-evidence.json");
  const value=JSON.parse(await readFile(path,"utf8")) as {subjects:Array<{sourceRevision:string}>};
  value.subjects[0]!.sourceRevision="0".repeat(40);
  await writeFile(path,`${JSON.stringify(value,null,2)}\n`);
  const mutatedSha256=createHash("sha256").update(await readFile(path)).digest("hex");
  assert.notEqual(mutatedSha256,trustedSha256);
  await assert.rejects(
    buildMediaCandidateRejectionReceipt(root,git,new Date("2026-08-19T00:01:00.000Z"),mutatedSha256,git.tree),
    /source revision.*does not match policy/i
  );
});

test("repository policy pins evidence-backed video and 3d rejections", async () => {
  const trustedSha256=createHash("sha256").update(await readFile(join(process.cwd(),"rights-production-evidence.json"))).digest("hex");
  const receipt = await buildMediaCandidateRejectionReceipt(process.cwd(), git, new Date("2026-08-19T00:01:00.000Z"),trustedSha256,git.tree);
  assert.deepEqual(
    receipt.candidates.map((candidate) => [candidate.kind, candidate.modelId, candidate.versionOrCommit]),
    [
      ["video", "stabilityai-svd-1.1-tensorrt", "32eaa3e7d521d402740f134d3390c9697fb99f3e"],
      ["3d", "facebook-vfusion3d", "0aeeaaca12806a10d7ba326992f84b0922f41188"]
    ]
  );
  assert.ok(receipt.candidates.every((candidate) => candidate.sources.every((source) => source.bytes > 0)));
  assert.ok(receipt.candidates.every((candidate) => candidate.routing.route === "PRODUCTION_PROVIDER" && candidate.routing.transportCalls === 0));
});
