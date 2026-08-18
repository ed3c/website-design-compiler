import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { request as requestHttp, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { resolve } from "node:path";
import type { CompilerReference, EvidenceState } from "./contracts.js";

export interface CaptureProvenance {
  adapter: string;
  sourceKind: CompilerReference["kind"];
  sourceMode: "INLINE" | "FILE" | "REMOTE" | "UNEXERCISED";
  requestedUrl?: string;
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  responseBytes?: number;
  responseSha256?: string;
  artifactIdentity?: string;
  capturedAt?: string;
  dnsResolutions?: RemoteDnsResolution[];
  redirectChain?: RemoteRedirectEvidence[];
  attemptCount?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  startedAt?: string;
  completedAt?: string;
  transportMode?: "PINNED_NETWORK" | "INJECTED_TEST";
  connectedAddress?: string;
}

export interface RemoteDnsResolution {
  attempt: number;
  hostname: string;
  addresses: string[];
  observedAt: string;
}

export interface RemoteRedirectEvidence {
  attempt: number;
  fromUrl: string;
  status: number;
  toUrl: string;
}

export interface CapturedReference {
  state: EvidenceState;
  facts: string[];
  provenance: CaptureProvenance;
  availability?: "AVAILABLE" | "UNAVAILABLE" | "NOT_ASSESSED";
  failureKind?: "AVAILABILITY" | "POLICY" | "COMPILER";
  reason?: string;
}

export interface RemoteCaptureDependencies {
  resolveHost?: (hostname: string) => Promise<string[]>;
  fetchImpl?: typeof globalThis.fetch;
  maxRedirects?: number;
  maxBytes?: number;
  now?: () => Date;
  maxAttempts?: number;
  retryBackoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  transport?: RemoteTransport;
}

export interface RemoteTransportRequest {
  url: URL;
  addresses: string[];
  timeoutMs: number;
  maxBytes: number;
}

export interface RemoteTransportResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
  connectedAddress?: string;
  mode: "PINNED_NETWORK" | "INJECTED_TEST";
}

export type RemoteTransport = (request: RemoteTransportRequest) => Promise<RemoteTransportResponse>;

type RemoteFailureKind = NonNullable<CapturedReference["failureKind"]>;

class RemoteCaptureError extends Error {
  constructor(
    readonly kind: RemoteFailureKind,
    message: string
  ) {
    super(message);
    this.name = "RemoteCaptureError";
  }
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function firstMatch(html: string, expression: RegExp): string | undefined {
  const match = expression.exec(html);
  return match?.[1] ? stripTags(match[1]) : undefined;
}

function countMatches(html: string, expression: RegExp): number {
  return Array.from(html.matchAll(expression)).length;
}

export function observeHtml(html: string): string[] {
  const facts: string[] = [];
  const title = firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) facts.push(`document title: ${title}`);

  for (let level = 1; level <= 3; level += 1) {
    const headingPattern = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi");
    const headings = Array.from(html.matchAll(headingPattern))
      .map((match) => (match[1] ? stripTags(match[1]) : ""))
      .filter(Boolean)
      .slice(0, 8);
    if (headings.length > 0) facts.push(`h${level} headings: ${headings.join(" | ")}`);
  }

  const structuralCounts: Array<[string, RegExp]> = [
    ["nav elements", /<nav\b[^>]*>/gi],
    ["main elements", /<main\b[^>]*>/gi],
    ["section elements", /<section\b[^>]*>/gi],
    ["links", /<a\b[^>]*href\s*=/gi],
    ["images", /<img\b[^>]*>/gi],
    ["videos", /<video\b[^>]*>/gi],
    ["canvas elements", /<canvas\b[^>]*>/gi]
  ];

  for (const [label, pattern] of structuralCounts) {
    const count = countMatches(html, pattern);
    if (count > 0) facts.push(`${label}: ${count}`);
  }

  const motionSignals = countMatches(
    html,
    /(?:data-(?:animate|motion|scroll)|aria-live\s*=|style\s*=\s*["'][^"']*(?:transform|animation|transition))/gi
  );
  if (motionSignals > 0) facts.push(`observable motion-related attributes/styles: ${motionSignals}`);

  return facts;
}

async function readHtmlReference(value: string): Promise<{ html: string; mode: "INLINE" | "FILE" }> {
  if (/<(?:!doctype|html|head|body|main|section|div|article|header|footer)\b/i.test(value)) {
    return { html: value, mode: "INLINE" };
  }
  return { html: await readFile(resolve(value), "utf8"), mode: "FILE" };
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  const firstHextet = normalized.split(":")[0];
  if (!firstHextet) return false;
  const prefix = Number.parseInt(firstHextet, 16);
  if (!Number.isInteger(prefix) || prefix < 0x2000 || prefix > 0x3fff) return false;
  if (/^2001:db8(?:$|:)/.test(normalized)) return false;
  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function withAvailabilityTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolveOperation, rejectOperation) => {
      timer = setTimeout(() => {
        rejectOperation(new RemoteCaptureError("AVAILABILITY", `${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      void operation.then(resolveOperation, rejectOperation);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function validateRemoteTarget(
  url: URL,
  resolveHost: (hostname: string) => Promise<string[]>,
  timeoutMs: number
): Promise<string[]> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RemoteCaptureError("POLICY", "remote reference protocol must be http or https");
  }
  if (url.username || url.password) throw new RemoteCaptureError("POLICY", "remote reference URL credentials are forbidden");
  if (url.search || url.hash) {
    throw new RemoteCaptureError("POLICY", "remote reference URL query and fragment are forbidden in public evidence");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new RemoteCaptureError("POLICY", "remote reference non-standard ports are forbidden");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new RemoteCaptureError("POLICY", "remote reference resolved to a non-public address (private hostname forbidden)");
  }
  let addresses: string[];
  try {
    addresses = isIP(hostname)
      ? [hostname]
      : await withAvailabilityTimeout(resolveHost(hostname), timeoutMs, "remote reference DNS resolution");
  } catch (error) {
    if (error instanceof RemoteCaptureError) throw error;
    throw new RemoteCaptureError("AVAILABILITY", "remote reference DNS resolution unavailable");
  }
  if (addresses.length === 0) throw new RemoteCaptureError("AVAILABILITY", "remote reference hostname resolved to no addresses");
  if (addresses.some((address) => !isPublicIpAddress(address))) {
    throw new RemoteCaptureError("POLICY", "remote reference resolved to a non-public address");
  }
  return addresses;
}

function remoteError(error: unknown): RemoteCaptureError {
  if (error instanceof RemoteCaptureError) return error;
  return new RemoteCaptureError("AVAILABILITY", "remote reference transport unavailable");
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(Math.trunc(value), maximum));
}

async function fetchWithTimeout(fetchImpl: typeof globalThis.fetch, request: RemoteTransportRequest): Promise<RemoteTransportResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await new Promise<Response>((resolveResponse, rejectResponse) => {
      timer = setTimeout(() => {
        controller.abort();
        rejectResponse(new RemoteCaptureError("AVAILABILITY", `remote reference transport timed out after ${request.timeoutMs}ms`));
      }, request.timeoutMs);
      void fetchImpl(request.url, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9",
          "user-agent": "website-design-compiler-reference-capture/1"
        },
        signal: controller.signal
      }).then(resolveResponse, rejectResponse);
    });
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > request.maxBytes) {
      throw new RemoteCaptureError("COMPILER", `remote reference exceeds ${request.maxBytes} byte limit`);
    }
    return { status: response.status, headers: response.headers, body, mode: "INJECTED_TEST" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function headersFromNode(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

function pinnedNetworkTransport(request: RemoteTransportRequest): Promise<RemoteTransportResponse> {
  return new Promise((resolveResponse, rejectResponse) => {
    const selectedAddress = request.addresses[0];
    const family = selectedAddress ? isIP(selectedAddress) : 0;
    if (!selectedAddress || (family !== 4 && family !== 6)) {
      rejectResponse(new RemoteCaptureError("POLICY", "remote reference has no valid pinned public address"));
      return;
    }

    const options: RequestOptions = {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9",
        "user-agent": "website-design-compiler-reference-capture/1"
      },
      family,
      lookup: ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, addressFamily: number) => void) => {
        callback(null, selectedAddress, family);
      }) as RequestOptions["lookup"]
    };
    const requestFn = request.url.protocol === "https:" ? requestHttps : requestHttp;
    let connectedAddress: string | undefined;
    let settled = false;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTotalTimer = () => {
      if (totalTimer !== undefined) clearTimeout(totalTimer);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTotalTimer();
      rejectResponse(remoteError(error));
    };
    const clientRequest = requestFn(request.url, options, (response) => {
      const chunks: Uint8Array[] = [];
      let byteCount = 0;
      response.on("data", (chunk: Buffer) => {
        byteCount += chunk.byteLength;
        if (byteCount > request.maxBytes) {
          response.destroy(new RemoteCaptureError("COMPILER", `remote reference exceeds ${request.maxBytes} byte limit`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", settleReject);
      response.on("end", () => {
        if (settled) return;
        if (!connectedAddress || !request.addresses.includes(connectedAddress)) {
          settleReject(new RemoteCaptureError("POLICY", "remote reference connected address did not match pinned DNS evidence"));
          return;
        }
        settled = true;
        clearTotalTimer();
        resolveResponse({
          status: response.statusCode ?? 0,
          headers: headersFromNode(response.headers),
          body: Buffer.concat(chunks),
          connectedAddress,
          mode: "PINNED_NETWORK"
        });
      });
    });
    clientRequest.on("socket", (socket) => {
      socket.once("connect", () => {
        connectedAddress = socket.remoteAddress;
        if (!connectedAddress || !request.addresses.includes(connectedAddress)) {
          clientRequest.destroy(new RemoteCaptureError("POLICY", "remote reference connected address did not match pinned DNS evidence"));
        }
      });
    });
    totalTimer = setTimeout(() => {
      clientRequest.destroy(new RemoteCaptureError("AVAILABILITY", `remote reference transport timed out after ${request.timeoutMs}ms`));
    }, request.timeoutMs);
    clientRequest.on("error", settleReject);
    clientRequest.end();
  });
}

export async function captureRemoteUrl(value: string, dependencies: RemoteCaptureDependencies = {}): Promise<CapturedReference> {
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost;
  const transport = dependencies.transport
    ?? (dependencies.fetchImpl ? (request: RemoteTransportRequest) => fetchWithTimeout(dependencies.fetchImpl!, request) : pinnedNetworkTransport);
  const maxRedirects = boundedInteger(dependencies.maxRedirects, 3, 0, 10);
  const maxBytes = boundedInteger(dependencies.maxBytes, 2 * 1024 * 1024, 1, 8 * 1024 * 1024);
  const now = dependencies.now ?? (() => new Date());
  const maxAttempts = boundedInteger(dependencies.maxAttempts, 3, 1, 5);
  const retryBackoffMs = boundedInteger(dependencies.retryBackoffMs, 250, 0, 5_000);
  const sleep = dependencies.sleep ?? defaultSleep;
  const timeoutMs = boundedInteger(dependencies.timeoutMs, 10_000, 1, 30_000);
  const startedAt = now().toISOString();
  let requested: URL;
  try {
    requested = new URL(value);
  } catch {
    return {
      state: "FAIL",
      availability: "NOT_ASSESSED",
      failureKind: "POLICY",
      facts: [],
      provenance: {
        adapter: "remote-url-observer/v1",
        sourceKind: "url",
        sourceMode: "REMOTE",
        maxAttempts,
        timeoutMs,
        startedAt,
        completedAt: now().toISOString()
      },
      reason: "remote reference URL is invalid"
    };
  }
  let current = new URL(requested);
  const dnsResolutions: RemoteDnsResolution[] = [];
  const redirectChain: RemoteRedirectEvidence[] = [];
  let receiptRequestedUrl: string | undefined;
  let receiptCurrentUrl: string | undefined;
  let lastHttpStatus: number | undefined;

  for (let attemptCount = 1; attemptCount <= maxAttempts; attemptCount += 1) {
    current = new URL(requested);
    let preparedAddresses: string[] | undefined;
    try {
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        const addresses = preparedAddresses ?? await validateRemoteTarget(current, resolveHost, timeoutMs);
        if (!preparedAddresses) {
          dnsResolutions.push({ attempt: attemptCount, hostname: current.hostname, addresses, observedAt: now().toISOString() });
        }
        preparedAddresses = undefined;
        receiptRequestedUrl ??= requested.toString();
        receiptCurrentUrl = current.toString();
        let response: RemoteTransportResponse;
        try {
          response = await withAvailabilityTimeout(
            transport({ url: current, addresses, timeoutMs, maxBytes }),
            timeoutMs,
            "remote reference transport"
          );
        } catch (error) {
          throw remoteError(error);
        }
        lastHttpStatus = response.status;
        if (response.mode === "PINNED_NETWORK" && (!response.connectedAddress || !addresses.includes(response.connectedAddress))) {
          throw new RemoteCaptureError("POLICY", "remote reference connected address did not match pinned DNS evidence");
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new RemoteCaptureError("COMPILER", "remote reference redirect missing Location header");
          if (redirectCount === maxRedirects) throw new RemoteCaptureError("COMPILER", "remote reference redirect limit exceeded");
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            throw new RemoteCaptureError("COMPILER", "remote reference redirect Location is invalid");
          }
          const nextAddresses = await validateRemoteTarget(next, resolveHost, timeoutMs);
          dnsResolutions.push({ attempt: attemptCount, hostname: next.hostname, addresses: nextAddresses, observedAt: now().toISOString() });
          redirectChain.push({ attempt: attemptCount, fromUrl: current.toString(), status: response.status, toUrl: next.toString() });
          current = next;
          receiptCurrentUrl = current.toString();
          preparedAddresses = nextAddresses;
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          const kind: RemoteFailureKind = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
            ? "AVAILABILITY"
            : "COMPILER";
          throw new RemoteCaptureError(kind, `remote reference returned HTTP ${response.status}`);
        }
        const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
          throw new RemoteCaptureError("COMPILER", `remote reference content type is not HTML: ${contentType || "missing"}`);
        }
        const body = response.body;
        if (body.byteLength > maxBytes) {
          throw new RemoteCaptureError("COMPILER", `remote reference exceeds ${maxBytes} byte limit`);
        }
        const html = new TextDecoder("utf-8", { fatal: false }).decode(body);
        const responseSha256 = createHash("sha256").update(body).digest("hex");
        const completedAt = now().toISOString();
        return {
          state: "PASS",
          availability: "AVAILABLE",
          facts: observeHtml(html),
          provenance: {
            adapter: "remote-url-observer/v1",
            sourceKind: "url",
            sourceMode: "REMOTE",
            requestedUrl: receiptRequestedUrl,
            finalUrl: receiptCurrentUrl,
            httpStatus: response.status,
            contentType,
            responseBytes: body.byteLength,
            responseSha256,
            artifactIdentity: `sha256:${responseSha256}`,
            capturedAt: completedAt,
            dnsResolutions,
            redirectChain,
            attemptCount,
            maxAttempts,
            timeoutMs,
            startedAt,
            completedAt,
            transportMode: response.mode,
            ...(response.connectedAddress ? { connectedAddress: response.connectedAddress } : {})
          }
        };
      }
      throw new RemoteCaptureError("COMPILER", "remote reference redirect state exhausted");
    } catch (error) {
      const failure = remoteError(error);
      if (failure.kind === "AVAILABILITY" && attemptCount < maxAttempts) {
        await sleep(retryBackoffMs * 2 ** (attemptCount - 1));
        continue;
      }
      return {
        state: failure.kind === "AVAILABILITY" ? "NOT_EXERCISED" : "FAIL",
        availability: failure.kind === "AVAILABILITY" ? "UNAVAILABLE" : failure.kind === "COMPILER" ? "AVAILABLE" : "NOT_ASSESSED",
        failureKind: failure.kind,
        facts: [],
        provenance: {
          adapter: "remote-url-observer/v1",
          sourceKind: "url",
          sourceMode: "REMOTE",
          ...(receiptRequestedUrl ? { requestedUrl: receiptRequestedUrl } : {}),
          ...(receiptCurrentUrl ? { finalUrl: receiptCurrentUrl } : {}),
          ...(lastHttpStatus ? { httpStatus: lastHttpStatus } : {}),
          dnsResolutions,
          redirectChain,
          attemptCount,
          maxAttempts,
          timeoutMs,
          startedAt,
          completedAt: now().toISOString()
        },
        reason: failure.message
      };
    }
  }

  throw new Error("remote reference attempt state exhausted");
}

export async function captureReference(reference: CompilerReference): Promise<CapturedReference> {
  if (reference.kind === "html") {
    try {
      const { html, mode } = await readHtmlReference(reference.value);
      return {
        state: "PASS",
        facts: observeHtml(html),
        provenance: { adapter: "html-observer/v1", sourceKind: reference.kind, sourceMode: mode }
      };
    } catch (error) {
      return {
        state: "FAIL",
        facts: [],
        provenance: { adapter: "html-observer/v1", sourceKind: reference.kind, sourceMode: "FILE" },
        reason: error instanceof Error ? error.message : "HTML capture failed"
      };
    }
  }

  if (reference.kind === "url") {
    if (process.env.WDC_REFERENCE_NETWORK !== "1") {
      return {
        state: "NOT_EXERCISED",
        facts: [],
        provenance: { adapter: "remote-url-observer/v1", sourceKind: reference.kind, sourceMode: "UNEXERCISED" },
        reason: "Remote URL capture is implemented but disabled unless WDC_REFERENCE_NETWORK=1; deterministic release fixtures do not depend on external network state."
      };
    }
    return captureRemoteUrl(reference.value);
  }

  return {
    state: "NOT_EXERCISED",
    facts: [],
    provenance: { adapter: `${reference.kind}-observer/v1`, sourceKind: reference.kind, sourceMode: "UNEXERCISED" },
    reason: `${reference.kind} observation requires a dedicated media/browser adapter.`
  };
}
