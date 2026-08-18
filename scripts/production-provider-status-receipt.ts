import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { buildUnconfiguredProductionProviderStatus } from "../src/production-media-provider.js";
import { executeProductionProviderConfiguration, validateProductionProviderExecutionConfig, type ProductionProviderExecutionConfig } from "../src/production-provider-execution.js";
import type { SignedMediaRequest } from "../src/media-router.js";
import type { ProductionProviderPolicy, ProductionProviderReceipt } from "../src/production-media-provider.js";
import type { ProductionAdmissionPacket } from "../src/production-provider-admission.js";
import type { RepositoryClearanceReceipt } from "../src/repository-rights-clearance.js";
import { validateAgainstSchema } from "../src/validate.js";

const git={sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"};
const configPath = process.env.WDC_PRODUCTION_PROVIDER_CONFIG;
let status = buildUnconfiguredProductionProviderStatus();
let executionReceipt: ProductionProviderReceipt | undefined;
let generatedAsset:{bytes:Uint8Array;mediaType:string;extension:string}|undefined;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
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
    const configDirectory = dirname(absoluteConfigPath);
    const [signed, policy, rightsReceipt, admissionPacket, admissionPublicKeyPem] = await Promise.all([
      readJson<SignedMediaRequest>(await resolveConfigFile(configDirectory, config.signedRequestPath)),
      readJson<ProductionProviderPolicy>(await resolveConfigFile(configDirectory, config.policyPath)),
      readJson<RepositoryClearanceReceipt & {git:{sha:string;ref:string}}>(await resolveConfigFile(configDirectory, config.rightsReceiptPath)),
      readJson<ProductionAdmissionPacket>(await resolveConfigFile(configDirectory, config.admissionPacketPath)),
      readFile(await resolveConfigFile(configDirectory, config.admissionAuthority.publicKeyPath), "utf8")
    ]);
    await validateAgainstSchema(admissionPacket, "production-provider-admission.schema.json");
    await validateAgainstSchema(rightsReceipt, "repository-rights-clearance.schema.json");
    if(rightsReceipt.git.sha!==git.sha||rightsReceipt.git.ref!==git.ref)throw new Error("repository rights receipt is not bound to the provider execution subject");
    const result = await executeProductionProviderConfiguration({
      config, signed, policy, rightsReceipt, admissionPacket, admissionPublicKeyPem,
      requestSecret, providerCredential
    });
    status = result.status;
    executionReceipt = result.receipt;
    generatedAsset = result.asset;
  }
}

const directory = resolve("artifacts/media-generator");
const receiptPath = "artifacts/media-generator/production-provider-status.json";
const outputPath = resolve(receiptPath);

await mkdir(directory, { recursive: true });
let artifacts:undefined|{
  executionReceipt:{path:string;sha256:string;bytes:number};
  asset:{path:string;sha256:string;bytes:number;mediaType:string};
};
if (executionReceipt) {
  const executionBytes=Buffer.from(`${JSON.stringify(executionReceipt,null,2)}\n`);
  const executionPath=resolve(directory,"production-provider-execution-receipt.json");
  await writeFile(executionPath,executionBytes);
  if(executionReceipt.overall==="PASS"){
    if(!generatedAsset||!executionReceipt.asset)throw new Error("PASS production provider execution did not return persisted asset bytes");
    const assetPathName=`production-provider-asset.${executionReceipt.asset.extension}`;
    const assetPath=resolve(directory,assetPathName);
    await writeFile(assetPath,generatedAsset.bytes);
    const [receiptReadback,assetReadback]=await Promise.all([readFile(executionPath),readFile(assetPath)]);
    const executionSha256=createHash("sha256").update(receiptReadback).digest("hex");
    const assetSha256=createHash("sha256").update(assetReadback).digest("hex");
    if(assetSha256!==executionReceipt.asset.sha256||assetReadback.byteLength!==executionReceipt.asset.bytes)throw new Error("persisted production asset does not match execution receipt");
    status={...status,executionReceiptSha256:executionSha256,assetSha256};
    artifacts={executionReceipt:{path:"production-provider-execution-receipt.json",sha256:executionSha256,bytes:receiptReadback.byteLength},asset:{path:assetPathName,sha256:assetSha256,bytes:assetReadback.byteLength,mediaType:executionReceipt.asset.mediaType}};
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
