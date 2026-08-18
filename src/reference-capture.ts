import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import type { CompilerReference, EvidenceState } from "./contracts.js";
import {
  injectedFetchTransport,
  productionPinnedTransport,
  sameNetworkAddress,
  type PinnedTransport
} from "./pinned-http-transport.js";

export interface CaptureProvenance {
  adapter: string;
  sourceKind: CompilerReference["kind"];
  sourceMode: "INLINE" | "FILE" | "REMOTE" | "UNEXERCISED";
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  responseSha256?: string;
  connectedAddress?: string;
  transportMode?: "PRODUCTION" | "INJECTED";
}

export interface CapturedReference {
  state: EvidenceState;
  facts: string[];
  provenance: CaptureProvenance;
  reason?: string;
}

export interface RemoteCaptureDependencies {
  resolveHost?: (hostname: string) => Promise<string[]>;
  fetchImpl?: typeof globalThis.fetch;
  transport?: PinnedTransport;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
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
  return !/^2001:db8(?:$|:)/.test(normalized);
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

async function withDeadline<T>(operation: Promise<T>, deadlineAt: number, label: string): Promise<T> {
  const remaining = Math.max(0, Math.ceil(deadlineAt - Date.now()));
  if (remaining === 0) throw new Error(`remote reference total deadline exceeded before ${label}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolveOperation, rejectOperation) => {
      timer = setTimeout(() => rejectOperation(new Error(`remote reference total deadline exceeded during ${label}`)), remaining);
      void operation.then(resolveOperation, rejectOperation);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function validateRemoteTarget(url: URL, resolveHost: (hostname: string) => Promise<string[]>, deadlineAt: number): Promise<string[]> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("remote reference protocol must be http or https");
  if (url.username || url.password) throw new Error("remote reference URL credentials are forbidden");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("remote reference non-standard ports are forbidden");
  const addresses = isIP(url.hostname) ? [url.hostname] : await withDeadline(resolveHost(url.hostname), deadlineAt, "DNS resolution");
  if (addresses.length === 0) throw new Error("remote reference hostname resolved to no addresses");
  if (addresses.some((address) => !isPublicIpAddress(address))) throw new Error("remote reference resolved to a non-public address");
  return addresses;
}

export async function captureRemoteUrl(value: string, dependencies: RemoteCaptureDependencies = {}): Promise<CapturedReference> {
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost;
  if (dependencies.fetchImpl && dependencies.transport) throw new Error("remote reference accepts either fetchImpl or transport, not both");
  const transport = dependencies.transport ?? (dependencies.fetchImpl ? injectedFetchTransport(dependencies.fetchImpl) : productionPinnedTransport);
  const maxRedirects = dependencies.maxRedirects ?? 3;
  const maxBytes = dependencies.maxBytes ?? 2 * 1024 * 1024;
  const timeoutMs = dependencies.timeoutMs ?? 10_000;
  const deadlineAt = Date.now() + timeoutMs;
  let current = new URL(value);

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const addresses = await validateRemoteTarget(current, resolveHost, deadlineAt);
      const selectedAddress = addresses[0]!;
      const response = await withDeadline(
        transport({ url: current, resolvedAddress: selectedAddress, deadlineAt, maxBytes }),
        deadlineAt,
        "transport"
      );
      if (!sameNetworkAddress(response.connectedAddress, selectedAddress)) {
        throw new Error("connected peer address does not match pinned DNS resolution");
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location) throw new Error("remote reference redirect missing Location header");
        if (redirectCount === maxRedirects) throw new Error("remote reference redirect limit exceeded");
        current = new URL(location, current);
        continue;
      }

      if (response.status < 200 || response.status >= 300) throw new Error(`remote reference returned HTTP ${response.status}`);
      const contentType = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
        throw new Error(`remote reference content type is not HTML: ${contentType || "missing"}`);
      }
      const body = response.body;
      if (body.byteLength > maxBytes) throw new Error(`remote reference exceeds ${maxBytes} byte limit`);
      const html = new TextDecoder("utf-8", { fatal: false }).decode(body);
      return {
        state: response.mode === "PRODUCTION" ? "PASS" : "NOT_EXERCISED",
        facts: observeHtml(html),
        provenance: {
          adapter: "remote-url-observer/v2",
          sourceKind: "url",
          sourceMode: "REMOTE",
          finalUrl: current.toString(),
          httpStatus: response.status,
          contentType,
          responseSha256: createHash("sha256").update(body).digest("hex"),
          connectedAddress: response.connectedAddress,
          transportMode: response.mode
        },
        ...(response.mode === "INJECTED" ? { reason: "Injected transport exercises deterministic controls but cannot promote production remote evidence to PASS." } : {})
      };
    }
    throw new Error("remote reference redirect state exhausted");
  } catch (error) {
    return {
      state: "FAIL",
      facts: [],
      provenance: { adapter: "remote-url-observer/v2", sourceKind: "url", sourceMode: "REMOTE", finalUrl: current.toString() },
      reason: error instanceof Error ? error.message : "remote URL capture failed"
    };
  }
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
        provenance: { adapter: "remote-url-observer/v2", sourceKind: reference.kind, sourceMode: "UNEXERCISED" },
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
