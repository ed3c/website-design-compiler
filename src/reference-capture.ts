import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompilerReference, EvidenceState } from "./contracts.js";

export interface CapturedReference {
  state: EvidenceState;
  facts: string[];
  provenance: {
    adapter: string;
    sourceKind: CompilerReference["kind"];
    sourceMode: "INLINE" | "FILE" | "REMOTE" | "UNEXERCISED";
  };
  reason?: string;
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
    return {
      state: "NOT_EXERCISED",
      facts: [],
      provenance: { adapter: "remote-url-observer/v1", sourceKind: reference.kind, sourceMode: "UNEXERCISED" },
      reason: "Remote URL capture requires an explicit network-enabled adapter and deterministic capture receipt."
    };
  }

  return {
    state: "NOT_EXERCISED",
    facts: [],
    provenance: { adapter: `${reference.kind}-observer/v1`, sourceKind: reference.kind, sourceMode: "UNEXERCISED" },
    reason: `${reference.kind} observation requires a dedicated media/browser adapter.`
  };
}
