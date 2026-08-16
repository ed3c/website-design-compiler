import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import type { CompilerReference, EvidenceState } from "./contracts.js";

export interface CaptureProvenance {
  adapter: string;
  sourceKind: CompilerReference["kind"];
  sourceMode: "INLINE" | "FILE" | "REMOTE" | "UNEXERCISED";
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  responseSha256?: string;
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
  maxRedirects?: number;
  maxBytes?: number;
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
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith("ff")) return false;
  if (normalized.startsWith("2001:db8")) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  if (mapped) return isPublicIpv4(mapped);
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

async function validateRemoteTarget(url: URL, resolveHost: (hostname: string) => Promise<string[]>): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("remote reference protocol must be http or https");
  if (url.username || url.password) throw new Error("remote reference URL credentials are forbidden");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("remote reference non-standard ports are forbidden");
  const addresses = isIP(url.hostname) ? [url.hostname] : await resolveHost(url.hostname);
  if (addresses.length === 0) throw new Error("remote reference hostname resolved to no addresses");
  if (addresses.some((address) => !isPublicIpAddress(address))) throw new Error("remote reference resolved to a non-public address");
}

export async function captureRemoteUrl(value: string, dependencies: RemoteCaptureDependencies = {}): Promise<CapturedReference> {
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const maxRedirects = dependencies.maxRedirects ?? 3;
  const maxBytes = dependencies.maxBytes ?? 2 * 1024 * 1024;
  let current = new URL(value);

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      await validateRemoteTarget(current, resolveHost);
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9",
          "user-agent": "website-design-compiler-reference-capture/1"
        }
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("remote reference redirect missing Location header");
        if (redirectCount === maxRedirects) throw new Error("remote reference redirect limit exceeded");
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) throw new Error(`remote reference returned HTTP ${response.status}`);
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
        throw new Error(`remote reference content type is not HTML: ${contentType || "missing"}`);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > maxBytes) throw new Error(`remote reference exceeds ${maxBytes} byte limit`);
      const html = new TextDecoder("utf-8", { fatal: false }).decode(body);
      return {
        state: "PASS",
        facts: observeHtml(html),
        provenance: {
          adapter: "remote-url-observer/v1",
          sourceKind: "url",
          sourceMode: "REMOTE",
          finalUrl: current.toString(),
          httpStatus: response.status,
          contentType,
          responseSha256: createHash("sha256").update(body).digest("hex")
        }
      };
    }
    throw new Error("remote reference redirect state exhausted");
  } catch (error) {
    return {
      state: "FAIL",
      facts: [],
      provenance: { adapter: "remote-url-observer/v1", sourceKind: "url", sourceMode: "REMOTE", finalUrl: current.toString() },
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
