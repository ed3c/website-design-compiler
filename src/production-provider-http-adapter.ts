import type {
  ProductionProviderIdentity,
  ProductionProviderTransport,
  ProductionProviderTransportResult
} from "./production-media-provider.js";
import { ProductionProviderError } from "./production-media-provider.js";
import { canonicalMediaValue, sha256 } from "./media-router.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicIpAddress } from "./reference-capture.js";
import { injectedFetchTransport, productionPinnedTransport, type PinnedTransport } from "./pinned-http-transport.js";

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

function isCanonicalBase64(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && canonicalBase64.test(value) && Buffer.from(value, "base64").toString("base64") === value;
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

async function defaultResolveHost(hostname:string):Promise<string[]>{return(await lookup(hostname,{all:true,verbatim:true})).map((entry)=>entry.address);}

async function readBoundedResponse(bytes: Uint8Array, maxBytes: number): Promise<string> {
  if (bytes.byteLength === 0) throw new ProductionProviderError("INVALID_RESPONSE", "provider response body is absent");
  if (bytes.byteLength > maxBytes) throw new ProductionProviderError("INVALID_RESPONSE", "provider response exceeds the admitted response budget");
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
  if (!isCanonicalBase64(value.asset.bytesBase64)) {
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
  resolveHost?: (hostname:string)=>Promise<string[]>;
  pinnedTransport?: PinnedTransport;
}): ProductionProviderTransport {
  const errors = validateHttpProductionProviderAdapterConfig(args.config);
  if (errors.length > 0) throw new Error(`invalid HTTP production provider adapter: ${errors.join("; ")}`);
  if (!args.credential || /[\r\n]/.test(args.credential)) throw new Error("production provider credential is absent or invalid");
  const resolveHost=args.resolveHost??defaultResolveHost;
  const transport=args.pinnedTransport??(args.fetchImpl?injectedFetchTransport(args.fetchImpl):productionPinnedTransport);
  return {
    identity: args.config.identity,
    configurationSha256: sha256(canonicalMediaValue(args.config)),
    async generate({ request, signal, attempt }) {
      const endpoint=new URL(args.config.endpoint);
      let addresses:string[];
      try{addresses=await resolveHost(endpoint.hostname);}catch{throw new ProductionProviderError("OUTAGE","provider DNS resolution failed");}
      if(addresses.length===0)throw new ProductionProviderError("OUTAGE","provider DNS resolution returned no addresses");
      if(addresses.some((address)=>!isPublicIpAddress(address)))throw new ProductionProviderError("INVALID_RESPONSE","provider endpoint resolved to a non-public address");
      const maximumResponseBytes=Math.min(67_108_864,Math.max(65_536,request.optimization.maxBytes*2));
      let response: Awaited<ReturnType<PinnedTransport>>;
      try {
        response = await transport({
          url:endpoint,
          resolvedAddress:addresses[0]!,
          deadlineAt:Date.now()+30_000,
          maxBytes:maximumResponseBytes,
          method: "POST",
          signal,
          headers: {
            authorization: `Bearer ${args.credential}`,
            "content-type": "application/json",
            accept: "application/json"
          },
          body:new TextEncoder().encode(JSON.stringify({
            schema: "website-design-compiler/http-production-provider-request/v1",
            identity: args.config.identity,
            request,
            attempt
          }))
        });
      } catch (error) {
        if (signal.aborted) throw new ProductionProviderError("CANCELLED", "provider request was cancelled");
        throw new ProductionProviderError("OUTAGE", "provider request failed before a response");
      }
      if (response.status === 429) throw new ProductionProviderError("RATE_LIMIT", "provider rate limited the request");
      if (response.status === 402) throw new ProductionProviderError("QUOTA", "provider quota rejected the request");
      if (response.status >= 500) throw new ProductionProviderError("OUTAGE", "provider service is unavailable");
      if (response.status < 200 || response.status >= 300) throw new ProductionProviderError("INVALID_RESPONSE", "provider rejected the request");
      const contentType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") throw new ProductionProviderError("INVALID_RESPONSE", "provider response content type is not application/json");
      const source = await readBoundedResponse(response.body,maximumResponseBytes);
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
