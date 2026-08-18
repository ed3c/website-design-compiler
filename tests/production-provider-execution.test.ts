import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { canonicalMediaValue, sha256, signMediaRequest, type MediaRequest } from "../src/media-router.js";
import { productionAdmissionPacketSha256, productionAdmissionSigningPayload, type ProductionAdmissionPacket } from "../src/production-provider-admission.js";
import {
  executeProductionProviderConfiguration,
  serializeProductionProviderExecutionEvidence,
  validateProductionProviderExecutionEvidence,
  validateProductionProviderExecutionConfig,
  type ProductionProviderExecutionConfig
} from "../src/production-provider-execution.js";
import type { ProductionProviderPolicy } from "../src/production-media-provider.js";
import type { RepositoryClearanceReceipt, RightsSubject } from "../src/repository-rights-clearance.js";
import { validateAgainstSchema } from "../src/validate.js";
import { RELEASE_CAPABILITY_SPECS, readBoundReleaseEvidence } from "../src/release-evidence.js";

const secret = "fixture-request-secret";
const request: MediaRequest = {
  schema: "website-design-compiler/media-request/v1",
  requestId: "configured-request-1",
  kind: "image",
  modelId: "fixture-model",
  prompt: "A neutral geometric product scene",
  parameters: { width: 16, height: 12, seed: 42 },
  optimization: { target: "web", maxBytes: 65_536 }
};
const policy: ProductionProviderPolicy = {
  schema: "website-design-compiler/production-provider-policy/v1",
  identity: {
    providerId: "fixture-provider",
    serviceRevision: "date:2026-08-01",
    modelId: "fixture-model",
    modelRevision: `sha256:${"a".repeat(64)}`,
    adapter: "diffusers-image",
    kind: "image"
  },
  rights: {
    modelWeight: { subjectId: "model:fixture-model", expectedIdentity: `sha256:${"a".repeat(64)}` },
    generatedOutput: { subjectId: "generated-output:fixture-model", expectedIdentity: `fixture-provider@date:2026-08-01/fixture-model@sha256:${"a".repeat(64)}` },
    hostedService: { subjectId: "service:fixture-provider", expectedIdentity: "fixture-provider@date:2026-08-01" }
  },
  controls: { timeoutMs: 100, maxAttempts: 1, retryBackoffMs: 0, requestsPerWindow: 1, quotaUnitsPerRequest: 1 },
  revocations: []
};
function subject(id: string, kind: RightsSubject["kind"], identity: string): RightsSubject {
  return {
    id, kind, name: id, versionOrIdentity: identity, licenseExpression: "TEST_ONLY_RIGHTS_EVIDENCE",
    state: "ALLOW", evidence: ["test fixture"], attributionRequired: false, distributed: false,
    geographicRestrictions: [], usageRestrictions: []
  };
}
const git={sha:"a".repeat(40),ref:"refs/heads/test"};
const rightsReceipt: RepositoryClearanceReceipt & {git:{sha:string;ref:string}} = {
  schema: "website-design-compiler/repository-rights-clearance/v2",
  overall: "PASS",
  generatedAt: "2026-08-18T00:00:00.000Z",
  subjects: [
    subject(policy.rights.modelWeight.subjectId, "model", policy.rights.modelWeight.expectedIdentity),
    subject(policy.rights.generatedOutput.subjectId, "generated-output", policy.rights.generatedOutput.expectedIdentity),
    subject(policy.rights.hostedService.subjectId, "service", policy.rights.hostedService.expectedIdentity)
  ],
  counts: { ALLOW: 3, REVIEW_REQUIRED: 0, DENY: 0, UNKNOWN: 0, NOT_DISTRIBUTED: 0 },
  unresolved: [], expiredWaivers: [], noticeSubjects: [], diagnostics: [],
  legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE",
  git
};
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const authorityKeySha256 = sha256(publicKey.export({ type: "spki", format: "der" }));
const config: ProductionProviderExecutionConfig = {
  schema: "website-design-compiler/production-provider-execution-config/v1",
  signedRequestPath: "signed-request.json",
  policyPath: "policy.json",
  admissionPacketPath: "admission.json",
  admissionAuthority: { authorityId: "fixture-reviewer", publicKeyPath: "reviewer.pub.pem" },
  adapter: {
    schema: "website-design-compiler/http-production-provider-adapter/v1",
    identity: policy.identity,
    endpoint: "https://provider.invalid/v1/generate"
  },
  requestSecretEnv: "WDC_FIXTURE_REQUEST_SECRET",
  credentialEnv: "WDC_FIXTURE_PROVIDER_CREDENTIAL"
};

function admission(): ProductionAdmissionPacket {
  const packet: ProductionAdmissionPacket = {
    schema: "website-design-compiler/production-provider-admission/v1",
    state: "ADMITTED",
    admissionId: "human-admit:configured:1",
    approvedBy: "fixture-reviewer",
    issuedAt: "2026-08-18T00:00:00.000Z",
    expiresAt: "2026-08-19T00:00:00.000Z",
    requestSha256: sha256(canonicalMediaValue(request)),
    providerIdentitySha256: sha256(canonicalMediaValue(policy.identity)),
    transportSha256: sha256(canonicalMediaValue(config.adapter)),
    modelIdentitySha256: sha256(canonicalMediaValue({ modelId: policy.identity.modelId, modelRevision: policy.identity.modelRevision, kind: policy.identity.kind })),
    policySha256: sha256(canonicalMediaValue(policy)),
    rightsReceiptSha256: sha256(canonicalMediaValue(rightsReceipt)),
    credentials: "AVAILABLE",
    budget: "AUTHORIZED",
    rateLimitRemaining: 1,
    quotaUnitsRemaining: 1,
    authorityKeySha256,
    signatureAlgorithm: "Ed25519",
    signatureBase64: "PENDING"
  };
  packet.signatureBase64 = sign(null, Buffer.from(productionAdmissionSigningPayload(packet)), privateKey).toString("base64");
  return packet;
}

test("configured status path composes signed admission, HTTP adapter, asset validation, and release-safe status", async () => {
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGOsCDjBQApgIkn1qIYRpAEAsVkBqEXr8uYAAAAASUVORK5CYII=";
  const result = await executeProductionProviderConfiguration({
    config,
    signed: { request, signature: signMediaRequest(request, secret) },
    policy,
    rightsReceipt,
    admissionPacket: admission(),
    admissionPublicKeyPem: publicKeyPem,
    requestSecret: secret,
    providerCredential: "fixture-provider-token",
    rightsReceiptBytesSha256: sha256(Buffer.from(`${JSON.stringify(rightsReceipt, null, 2)}\n`)),
    git,
    resolveHost: async()=>["93.184.216.34"],
    now: new Date("2026-08-18T12:00:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({
      schema: "website-design-compiler/http-production-provider-response/v1",
      providerRequestId: "provider-job-configured-1",
      seed: 42,
      postProcessing: [{ operation: "png-encode", revision: "version:1.0.0" }],
      asset: { mediaType: "image/png", extension: "png", bytesBase64: pngBase64 }
    }), { status: 200, headers: { "content-type": "application/json" } })
  });

  assert.equal(result.receipt.schema, "website-design-compiler/production-provider-receipt/v2");
  assert.equal(result.receipt.overall, "PASS");
  assert.equal(result.status.overall, "PASS");
  assert.equal(result.status.productionReleaseEligible, true);
  assert.match(result.status.providerIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.status.executionReceiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.status.assetSha256, result.receipt.asset?.sha256);
  assert.doesNotMatch(JSON.stringify(result.status), /fixture-provider-token|fixture-request-secret/);
  const executionInputBytes=serializeProductionProviderExecutionEvidence(result.executionEvidence);
  assert.equal(result.receipt.executionInputSha256,sha256(executionInputBytes));
  assert.deepEqual(validateProductionProviderExecutionEvidence(result.executionEvidence,rightsReceipt),[]);
  await validateAgainstSchema(result.executionEvidence,"production-provider-execution-evidence.schema.json");
  await validateAgainstSchema(result.receipt,"production-provider-receipt.schema.json");
  await validateAgainstSchema({
    ...result.status,
    executedAt:result.executionEvidence.executedAt,
    artifacts:{
      executionInput:{path:"production-provider-execution-input.json",sha256:result.receipt.executionInputSha256,bytes:executionInputBytes.byteLength},
      executionReceipt:{path:"production-provider-execution-receipt.json",sha256:"b".repeat(64),bytes:100},
      asset:{path:"production-provider-asset.png",sha256:result.status.assetSha256,bytes:80,mediaType:"image/png"}
    },
    git
  }, "production-provider-status.schema.json");

  const root=await mkdtemp(join(tmpdir(),"wdc-provider-release-valid-"));
  try{
    const providerDirectory=join(root,"artifacts/media-generator");
    const rightsPath=join(root,"artifacts/rights-clearance/repository-rights-clearance.json");
    await mkdir(providerDirectory,{recursive:true});
    await mkdir(dirname(rightsPath),{recursive:true});
    const executionBytes=Buffer.from(`${JSON.stringify(result.receipt,null,2)}\n`);
    const assetBytes=Buffer.from(result.asset?.bytes??[]);
    const status={...result.status,executedAt:result.executionEvidence.executedAt,executionReceiptSha256:sha256(executionBytes),assetSha256:sha256(assetBytes),artifacts:{executionInput:{path:"production-provider-execution-input.json",sha256:sha256(executionInputBytes),bytes:executionInputBytes.byteLength},executionReceipt:{path:"production-provider-execution-receipt.json",sha256:sha256(executionBytes),bytes:executionBytes.byteLength},asset:{path:"production-provider-asset.png",sha256:sha256(assetBytes),bytes:assetBytes.byteLength,mediaType:"image/png"}},git};
    await Promise.all([
      writeFile(join(providerDirectory,"production-provider-execution-input.json"),executionInputBytes),
      writeFile(join(providerDirectory,"production-provider-execution-receipt.json"),executionBytes),
      writeFile(join(providerDirectory,"production-provider-asset.png"),assetBytes),
      writeFile(rightsPath,`${JSON.stringify(rightsReceipt,null,2)}\n`),
      writeFile(join(root,RELEASE_CAPABILITY_SPECS.productionProvider.path),`${JSON.stringify(status,null,2)}\n`)
    ]);
    const bound=await readBoundReleaseEvidence(root,RELEASE_CAPABILITY_SPECS.productionProvider.path,RELEASE_CAPABILITY_SPECS.productionProvider.schema,git);
    assert.equal(bound.state,"PASS",bound.errors.join("; "));

    const tamperedInput=structuredClone(result.executionEvidence);
    tamperedInput.admissionPacket.rateLimitRemaining+=1;
    const tamperedInputBytes=serializeProductionProviderExecutionEvidence(tamperedInput);
    const tamperedExecution=structuredClone(result.receipt);
    tamperedExecution.executionInputSha256=sha256(tamperedInputBytes);
    tamperedExecution.admissionEvidence.admissionPacketSha256=productionAdmissionPacketSha256(tamperedInput.admissionPacket);
    const tamperedExecutionBytes=Buffer.from(`${JSON.stringify(tamperedExecution,null,2)}\n`);
    const tamperedStatus={...status,executionReceiptSha256:sha256(tamperedExecutionBytes),artifacts:{...status.artifacts,executionInput:{...status.artifacts.executionInput,sha256:sha256(tamperedInputBytes),bytes:tamperedInputBytes.byteLength},executionReceipt:{...status.artifacts.executionReceipt,sha256:sha256(tamperedExecutionBytes),bytes:tamperedExecutionBytes.byteLength}}};
    await Promise.all([
      writeFile(join(providerDirectory,"production-provider-execution-input.json"),tamperedInputBytes),
      writeFile(join(providerDirectory,"production-provider-execution-receipt.json"),tamperedExecutionBytes),
      writeFile(join(root,RELEASE_CAPABILITY_SPECS.productionProvider.path),`${JSON.stringify(tamperedStatus,null,2)}\n`)
    ]);
    const tampered=await readBoundReleaseEvidence(root,RELEASE_CAPABILITY_SPECS.productionProvider.path,RELEASE_CAPABILITY_SPECS.productionProvider.schema,git);
    assert.equal(tampered.state,"FAIL");
    assert.match(tampered.errors.join("; "),/signature verification failed/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("execution config rejects traversal, common environment variables, and secret reuse", () => {
  const errors = validateProductionProviderExecutionConfig({
    ...config,
    signedRequestPath: "../outside.json",
    requestSecretEnv: "HOME",
    credentialEnv: "HOME"
  }).join("; ");
  assert.match(errors, /signedRequestPath.*safe relative/);
  assert.match(errors, /requestSecretEnv.*dedicated/);
  assert.match(errors, /credentialEnv.*dedicated/);
  assert.match(errors, /separate environment/);
});

test("execution config cannot select an alternate repository rights receipt", async () => {
  await assert.rejects(
    validateAgainstSchema({ ...config, rightsReceiptPath: "alternate-rights.json" }, "production-provider-execution-config.schema.json"),
    /additional properties/
  );
});
