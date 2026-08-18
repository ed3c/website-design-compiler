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
      readJson<RepositoryClearanceReceipt>(await resolveConfigFile(configDirectory, config.rightsReceiptPath)),
      readJson<ProductionAdmissionPacket>(await resolveConfigFile(configDirectory, config.admissionPacketPath)),
      readFile(await resolveConfigFile(configDirectory, config.admissionAuthority.publicKeyPath), "utf8")
    ]);
    await validateAgainstSchema(admissionPacket, "production-provider-admission.schema.json");
    const result = await executeProductionProviderConfiguration({
      config, signed, policy, rightsReceipt, admissionPacket, admissionPublicKeyPem,
      requestSecret, providerCredential
    });
    status = result.status;
    executionReceipt = result.receipt;
  }
}

const receipt = {...status,git};
const directory = resolve("artifacts/media-generator");
const receiptPath = "artifacts/media-generator/production-provider-status.json";
const outputPath = resolve(receiptPath);

await validateAgainstSchema(receipt,"production-provider-status.schema.json");
await mkdir(directory, { recursive: true });
if (executionReceipt) {
  await writeFile(resolve(directory, "production-provider-execution-receipt.json"), `${JSON.stringify(executionReceipt, null, 2)}\n`, "utf8");
}
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  receiptPath,
  overall: receipt.overall,
  admissionState: receipt.admissionState,
  productionReleaseEligible: receipt.productionReleaseEligible
}));
