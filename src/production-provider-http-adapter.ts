import type {
  ProductionProviderIdentity,
  ProductionProviderTransport,
  ProductionProviderTransportResult
} from "./production-media-provider.js";
import { ProductionProviderError } from "./production-media-provider.js";
import { canonicalMediaValue, sha256 } from "./media-router.js";
import { isIP } from "node:net";

export interface HttpProductionProviderAdapterConfig {
  schema: "website-design-compiler/http-production-provider-adapter/v1";
  identity: ProductionProviderIdentity;
  endpoint: string;
}

const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const responseKeys = ["schema", "providerRequestId", "seed", "postProcessing", "asset"];
const assetKeys = ["mediaType", "extension", "bytesBase64"];

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateHttpProductionProviderAdapterConfig(config: HttpProductionProviderAdapterConfig): string[] {
  const errors: string[] = [];
  if (config.schema !== "website-design-compiler/http-production-provider-adapter/v1") errors.push("HTTP adapter schema is invalid");
  try {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:") errors.push("HTTP adapter endpoint must use HTTPS");
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      errors.push("HTTP adapter endpoint cannot contain credentials, query parameters, or fragments");
    }
    if (
      !endpoint.hostname ||
      isIP(endpoint.hostname) !== 0 ||
      endpoint.hostname === "localhost" ||
      endpoint.hostname.endsWith(".localhost") ||
      endpoint.hostname.endsWith(".local") ||
      endpoint.hostname.endsWith(".internal") ||
      endpoint.hostname.endsWith(".localdomain")
    ) {
      errors.push("HTTP adapter endpoint must identify an explicit non-local provider host");
    }
  } catch {
    errors.push("HTTP adapter endpoint is not an absolute URL");
  }
  return errors;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new ProductionProviderError("INVALID_RESPONSE", "provider response body is absent");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ProductionProviderError("INVALID_RESPONSE", "provider response exceeds the admitted response budget");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProductionProviderError) throw error;
    throw new ProductionProviderError("INVALID_RESPONSE", "provider response stream failed");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProductionProviderError("INVALID_RESPONSE", "provider response is not valid UTF-8 JSON");
  }
}

function parseTransportResult(value: unknown, maxAssetBytes: number): ProductionProviderTransportResult {
  if (!isRecord(value) || !exactKeys(value, responseKeys) || value.schema !== "website-design-compiler/http-production-provider-response/v1") {
    throw new ProductionProviderError("INVALID_RESPONSE", "provider response does not match the strict response envelope");
  }
  if (!isRecord(value.asset) || !exactKeys(value.asset, assetKeys)) {
    throw new ProductionProviderError("INVALID_RESPONSE", "provider asset does not match the strict response envelope");
  }
  if (typeof value.providerRequestId !== "string" || typeof value.asset.mediaType !== "string" || typeof value.asset.extension !== "string") {
    throw new ProductionProviderError("INVALID_RESPONSE", "provider response identifiers or media metadata are invalid");
  }
  if (value.seed !== null && typeof value.seed !== "string" && typeof value.seed !== "number") {
    throw new ProductionProviderError("INVALID_RESPONSE", "provider response seed is invalid");
  }
  if (!Array.isArray(value.postProcessing) || value.postProcessing.some((entry) =>
    !isRecord(entry) || !exactKeys(entry, ["operation", "revision"]) ||
    typeof entry.operation !== "string" || typeof entry.revision !== "string"
  )) {
    throw new ProductionProviderError("INVALID_RESPONSE", "provider post-processing provenance is invalid");
  }
  if (typeof value.asset.bytesBase64 !== "string" || !canonicalBase64.test(value.asset.bytesBase64) || value.asset.bytesBase64.length === 0) {
    throw new ProductionProviderError("INVALID_RESPONSE", "provider asset bytes are not canonical base64");
  }
  const bytes = new Uint8Array(Buffer.from(value.asset.bytesBase64, "base64"));
  if (bytes.byteLength === 0 || bytes.byteLength > maxAssetBytes) {
    throw new ProductionProviderError("INVALID_RESPONSE", "provider asset bytes exceed the admitted asset budget");
  }
  return {
    asset: { mediaType: value.asset.mediaType, extension: value.asset.extension, bytes },
    providerRequestId: value.providerRequestId,
    seed: value.seed,
    postProcessing: value.postProcessing as Array<{ operation: string; revision: string }>
  };
}

export function createHttpProductionProviderTransport(args: {
  config: HttpProductionProviderAdapterConfig;
  credential: string;
  fetchImpl?: typeof fetch;
}): ProductionProviderTransport {
  const errors = validateHttpProductionProviderAdapterConfig(args.config);
  if (errors.length > 0) throw new Error(`invalid HTTP production provider adapter: ${errors.join("; ")}`);
  if (!args.credential || /[\r\n]/.test(args.credential)) throw new Error("production provider credential is absent or invalid");
  const fetchImpl = args.fetchImpl ?? fetch;
  return {
    identity: args.config.identity,
    configurationSha256: sha256(canonicalMediaValue(args.config)),
    async generate({ request, signal, attempt }) {
      let response: Response;
      try {
        response = await fetchImpl(args.config.endpoint, {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            authorization: `Bearer ${args.credential}`,
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({
            schema: "website-design-compiler/http-production-provider-request/v1",
            identity: args.config.identity,
            request,
            attempt
          })
        });
      } catch (error) {
        if (signal.aborted) throw new ProductionProviderError("CANCELLED", "provider request was cancelled");
        throw new ProductionProviderError("OUTAGE", "provider request failed before a response");
      }
      if (response.status === 429) throw new ProductionProviderError("RATE_LIMIT", "provider rate limited the request");
      if (response.status === 402) throw new ProductionProviderError("QUOTA", "provider quota rejected the request");
      if (response.status >= 500) throw new ProductionProviderError("OUTAGE", "provider service is unavailable");
      if (!response.ok) throw new ProductionProviderError("INVALID_RESPONSE", "provider rejected the request");
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") throw new ProductionProviderError("INVALID_RESPONSE", "provider response content type is not application/json");
      const source = await readBoundedResponse(response, Math.max(65_536, request.optimization.maxBytes * 2));
      let value: unknown;
      try {
        value = JSON.parse(source);
      } catch {
        throw new ProductionProviderError("INVALID_RESPONSE", "provider response JSON cannot be parsed");
      }
      return parseTransportResult(value, request.optimization.maxBytes);
    }
  };
}
