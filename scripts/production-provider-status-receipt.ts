import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { buildUnconfiguredProductionProviderStatus } from "../src/production-media-provider.js";
import { validateMediaCandidateRejectionReadback, type MediaCandidateRejectionBinding } from "../src/media-candidate-rejection-readback.js";
import type { MediaCandidateRejectionReceipt } from "../src/media-candidate-rejection.js";
import { CANONICAL_REPOSITORY_RIGHTS_RECEIPT_PATH, executeProductionProviderConfiguration, validateProductionProviderExecutionConfig, type ProductionProviderExecutionConfig } from "../src/production-provider-execution.js";
import type { SignedMediaRequest } from "../src/media-router.js";
import type { ProductionProviderPolicy, ProductionProviderReceipt } from "../src/production-media-provider.js";
import type { ProductionAdmissionPacket } from "../src/production-provider-admission.js";
import { validateRepositoryClearanceReceipt, type RepositoryClearanceReceipt } from "../src/repository-rights-clearance.js";
import { validateAgainstSchema } from "../src/validate.js";
import { assertCleanTrackedGitSubject } from "../src/tracked-git-subject.js";

const git={sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"};
assertCleanTrackedGitSubject(process.cwd(),git.sha);
const configPath = process.env.WDC_PRODUCTION_PROVIDER_CONFIG;
let status = buildUnconfiguredProductionProviderStatus();
let executionReceipt: ProductionProviderReceipt | undefined;
let generatedAsset:{bytes:Uint8Array;mediaType:string;extension:string}|undefined;
let executionEvidence:Awaited<ReturnType<typeof executeProductionProviderConfiguration>>["executionEvidence"]|undefined;
let candidateRejectionBinding:MediaCandidateRejectionBinding|undefined;
const directory = resolve("artifacts/media-generator");

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonWithBytes<T>(path: string): Promise<{value:T;bytes:Buffer}> {
  const bytes=await readFile(path);
  return {value:JSON.parse(bytes.toString("utf8")) as T,bytes};
}

async function resolveConfigFile(configDirectory: string, path: string): Promise<string> {
  if (isAbsolute(path)) throw new Error("production provider config file references must be relative");
  const directory = await realpath(configDirectory);
  const target = await realpath(resolve(directory, path));
  const relation = relative(directory, target);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("production provider config file reference escapes its config directory");
  return target;
}

if (configPath) {
  const absoluteConfigPath = resolve(configPath);
  const config = await readJson<ProductionProviderExecutionConfig>(absoluteConfigPath);
  await validateAgainstSchema(config, "production-provider-execution-config.schema.json");
  const configErrors = validateProductionProviderExecutionConfig(config);
  if (configErrors.length > 0) throw new Error(`invalid production provider execution config: ${configErrors.join("; ")}`);
  const requestSecret = process.env[config.requestSecretEnv];
  const providerCredential = process.env[config.credentialEnv];
  if (!requestSecret || !providerCredential) {
    status = buildUnconfiguredProductionProviderStatus("configured production provider execution is NOT_EXERCISED because dedicated runtime credentials are absent");
  } else {
    const candidatePath=resolve(directory,"media-candidate-rejection.json");
    const candidateBytes=await readFile(candidatePath);
    const candidateReceipt=await validateAgainstSchema<MediaCandidateRejectionReceipt>(JSON.parse(candidateBytes.toString("utf8")),"media-candidate-rejection.schema.json");
    if(candidateReceipt.evidenceAdmission.trustedSha256==="ABSENT"||candidateReceipt.evidenceAdmission.trustedGitTree==="ABSENT")throw new Error("production candidate rejection is not externally admitted");
    candidateRejectionBinding={
      path:"media-candidate-rejection.json",
      schema:candidateReceipt.schema,
      sha256:createHash("sha256").update(candidateBytes).digest("hex"),
      bytes:candidateBytes.byteLength,
      sourceAdmissionSha256:candidateReceipt.evidenceAdmission.trustedSha256,
      trustedGitTree:candidateReceipt.evidenceAdmission.trustedGitTree
    };
    const trustedRightsEvidenceSha256=process.env.WDC_PRODUCTION_RIGHTS_EVIDENCE_SHA256?.trim();
    const trustedGitTree=process.env.WDC_PRODUCTION_CANDIDATE_TRUSTED_TREE?.trim();
    const candidateErrors=await validateMediaCandidateRejectionReadback({
      root:process.cwd(),
      binding:candidateRejectionBinding,
      expectedGit:{...git,tree:execFileSync("git",["rev-parse",`${git.sha}^{tree}`],{encoding:"utf8"}).trim()},
      ...(trustedRightsEvidenceSha256?{trustedRightsEvidenceSha256}:{}),
      ...(trustedGitTree?{trustedGitTree}:{})
    });
    if(candidateErrors.length>0)throw new Error(`production candidate rejection evidence is invalid: ${candidateErrors.join("; ")}`);
    const configDirectory = dirname(absoluteConfigPath);
    const [signed, policy, canonicalRights, admissionPacket, admissionPublicKeyPem] = await Promise.all([
      readJson<SignedMediaRequest>(await resolveConfigFile(configDirectory, config.signedRequestPath)),
      readJson<ProductionProviderPolicy>(await resolveConfigFile(configDirectory, config.policyPath)),
      readJsonWithBytes<RepositoryClearanceReceipt & {git:{sha:string;ref:string}}>(resolve(CANONICAL_REPOSITORY_RIGHTS_RECEIPT_PATH)),
      readJson<ProductionAdmissionPacket>(await resolveConfigFile(configDirectory, config.admissionPacketPath)),
      readFile(await resolveConfigFile(configDirectory, config.admissionAuthority.publicKeyPath), "utf8")
    ]);
    const rightsReceipt=canonicalRights.value;
    await validateAgainstSchema(admissionPacket, "production-provider-admission.schema.json");
    await validateAgainstSchema(rightsReceipt, "repository-rights-clearance.schema.json");
    const rightsErrors = validateRepositoryClearanceReceipt(rightsReceipt);
    if(rightsErrors.length>0)throw new Error(`repository rights receipt is invalid: ${rightsErrors.join("; ")}`);
    if(rightsReceipt.git.sha!==git.sha||rightsReceipt.git.ref!==git.ref)throw new Error("repository rights receipt is not bound to the provider execution subject");
    const result = await executeProductionProviderConfiguration({
      config, signed, policy, rightsReceipt, admissionPacket, admissionPublicKeyPem,
      requestSecret, providerCredential,
      rightsReceiptBytesSha256:createHash("sha256").update(canonicalRights.bytes).digest("hex"),
      git
    });
    status = result.status;
    executionReceipt = result.receipt;
    generatedAsset = result.asset;
    executionEvidence = result.executionEvidence;
  }
}

const receiptPath = "artifacts/media-generator/production-provider-status.json";
const outputPath = resolve(receiptPath);

await mkdir(directory, { recursive: true });
let artifacts:undefined|{
  executionInput:{path:string;sha256:string;bytes:number};
  executionReceipt:{path:string;sha256:string;bytes:number};
  asset:{path:string;sha256:string;bytes:number;mediaType:string};
  candidateRejection:MediaCandidateRejectionBinding;
};
if (executionReceipt) {
  await validateAgainstSchema(executionReceipt,"production-provider-receipt.schema.json");
  const executionBytes=Buffer.from(`${JSON.stringify(executionReceipt,null,2)}\n`);
  const executionPath=resolve(directory,"production-provider-execution-receipt.json");
  await writeFile(executionPath,executionBytes);
  if(executionReceipt.overall==="PASS"){
    if(!generatedAsset||!executionReceipt.asset||!executionEvidence)throw new Error("PASS production provider execution did not return persisted evidence and asset bytes");
    await validateAgainstSchema(executionEvidence,"production-provider-execution-evidence.schema.json");
    const executionInputBytes=Buffer.from(`${JSON.stringify(executionEvidence,null,2)}\n`);
    const executionInputPath=resolve(directory,"production-provider-execution-input.json");
    await writeFile(executionInputPath,executionInputBytes);
    const assetPathName=`production-provider-asset.${executionReceipt.asset.extension}`;
    const assetPath=resolve(directory,assetPathName);
    await writeFile(assetPath,generatedAsset.bytes);
    const [inputReadback,receiptReadback,assetReadback]=await Promise.all([readFile(executionInputPath),readFile(executionPath),readFile(assetPath)]);
    const executionInputSha256=createHash("sha256").update(inputReadback).digest("hex");
    const executionSha256=createHash("sha256").update(receiptReadback).digest("hex");
    const assetSha256=createHash("sha256").update(assetReadback).digest("hex");
    if(assetSha256!==executionReceipt.asset.sha256||assetReadback.byteLength!==executionReceipt.asset.bytes)throw new Error("persisted production asset does not match execution receipt");
    if(executionInputSha256!==executionReceipt.executionInputSha256)throw new Error("persisted production execution input does not match execution receipt");
    status={...status,executionReceiptSha256:executionSha256,assetSha256,executedAt:executionEvidence.executedAt};
    if(!candidateRejectionBinding)throw new Error("PASS production provider execution lacks candidate rejection evidence");
    artifacts={executionInput:{path:"production-provider-execution-input.json",sha256:executionInputSha256,bytes:inputReadback.byteLength},executionReceipt:{path:"production-provider-execution-receipt.json",sha256:executionSha256,bytes:receiptReadback.byteLength},asset:{path:assetPathName,sha256:assetSha256,bytes:assetReadback.byteLength,mediaType:executionReceipt.asset.mediaType},candidateRejection:candidateRejectionBinding};
  }
}
const receipt = {...status,...(artifacts?{artifacts}:{}),git};
await validateAgainstSchema(receipt,"production-provider-status.schema.json");
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  receiptPath,
  overall: receipt.overall,
  admissionState: receipt.admissionState,
  productionReleaseEligible: receipt.productionReleaseEligible
}));
