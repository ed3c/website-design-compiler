import { appendFile } from "node:fs/promises";
import { materializeProductionProviderBundle } from "../src/production-provider-bundle.js";

const result = await materializeProductionProviderBundle({
  ...(process.env.WDC_PRODUCTION_PROVIDER_BUNDLE_BASE64
    ? { encodedBundle: process.env.WDC_PRODUCTION_PROVIDER_BUNDLE_BASE64 }
    : {}),
  ...(process.env.WDC_PRODUCTION_PROVIDER_BUNDLE_SHA256
    ? { expectedSha256: process.env.WDC_PRODUCTION_PROVIDER_BUNDLE_SHA256 }
    : {})
});

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `config_path=${result.configPath}\n`, "utf8");
}
console.log(JSON.stringify({ state: result.state, configPath: result.configPath ? "MATERIALIZED_IN_EPHEMERAL_STORAGE" : "ABSENT" }));
