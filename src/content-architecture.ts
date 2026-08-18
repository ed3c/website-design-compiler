import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput, StageExecutionEvidence } from "./contracts.js";
import { compileInformationArchitecture, type IaSection } from "./information-architecture.js";
import { validateAgainstSchema } from "./validate.js";

export type ContentSourceType = "observed_fact" | "user_supplied_claim" | "derived_copy" | "placeholder_required" | "forbidden_invention";
export type ContentFieldState = "READY" | "NEEDS_INPUT" | "FORBIDDEN";

export interface ContentFieldContract {
  slot: string;
  state: ContentFieldState;
  sourceType: ContentSourceType;
  value: string | null;
  publishable: boolean;
  provenance: string[];
  lengthBudget: { maxCharacters: number };
}

export interface SectionContentContract {
  sectionId: string;
  sectionType: string;
  messageGoal: string;
  audienceQuestion: string;
  ctaRole: "PRIMARY" | "SECONDARY" | "NONE";
  fallback: string;
  localePolicy: { sourceLocale: "en"; localizationReady: true };
  fields: ContentFieldContract[];
  quality: {
    forbiddenPhraseHits: string[];
    repeatedPublishableValues: string[];
  };
}

export interface ContentArchitecturePlan {
  schema: "website-design-compiler/content-architecture/v2";
  project: string;
  audience: string;
  objective: string;
  sections: SectionContentContract[];
  forbiddenInventions: string[];
  overall: "READY" | "NEEDS_INPUT";
}

const FORBIDDEN_SLOTS = new Set([
  "customer-logos",
  "testimonials",
  "metrics",
  "pricing",
  "customer-names",
  "performance-claims"
]);

const EVIDENCE_REQUIRED_SLOTS = new Set(["proof-items", ...FORBIDDEN_SLOTS]);

const EMPTY_MARKETING_PHRASES = [
  "game-changing",
  "best-in-class",
  "world-class",
  "revolutionary",
  "cutting-edge",
  "seamless"
];

function maxCharactersFor(slot: string): number {
  if (slot.includes("headline")) return 120;
  if (slot.includes("action") || slot.includes("cta")) return 36;
  if (slot.includes("name")) return 64;
  if (slot.includes("description") || slot.includes("proposition") || slot === "task") return 220;
  return 280;
}

function planningProvenanceFor(slot: string, input: CompilerInput, section: IaSection): string[] {
  if (slot === "brand-or-project-name" || slot === "project-name") return [`compiler.project:${input.project}`];
  if (slot === "headline" || slot === "value-proposition" || slot === "product-description" || slot === "task") return [`brief.objective:${input.brief.objective}`];
  if (slot === "primary-action" || slot === "primary-action-label" || slot === "cta-label") return [`brief.objective:${input.brief.objective}`, `ia.section:${section.id}`];
  if (slot === "scene-purpose" || slot === "interaction-purpose") return [`ia.section:${section.id}`, ...section.evidence];
  return [];
}

function audienceQuestion(section: IaSection, audience: string): string {
  return `What does ${audience} need to understand from ${section.id}?`;
}

function ctaRole(section: IaSection): "PRIMARY" | "SECONDARY" | "NONE" {
  if (section.id === "navigation" || section.id === "conversion") return "PRIMARY";
  if (section.id.includes("hero")) return "SECONDARY";
  return "NONE";
}

function evidenceSha256(source: string, excerpt: string): string {
  return createHash("sha256").update(`${source}\0${excerpt}`).digest("hex");
}

function fieldFor(slot: string, input: CompilerInput, section: IaSection, forbidden: Set<string>): ContentFieldContract {
  const maxCharacters = maxCharactersFor(slot);
  const authored = input.authoredContent?.[slot];
  const evidence = authored?.evidence;
  const evidenceVerified = evidence !== undefined &&
    evidence.sha256 === evidenceSha256(evidence.source, evidence.excerpt);
  if ((forbidden.has(slot) || EVIDENCE_REQUIRED_SLOTS.has(slot)) && !evidenceVerified) {
    return {
      slot,
      state: "NEEDS_INPUT",
      sourceType: "placeholder_required",
      value: null,
      publishable: false,
      provenance: [`policy.evidence-required:${slot}`],
      lengthBudget: { maxCharacters }
    };
  }

  const authoredValue = authored?.value;
  const projectValue = slot === "brand-or-project-name" || slot === "project-name" ? input.project : undefined;
  const value = authoredValue ?? projectValue;
  if (!value || value.length > maxCharacters) {
    return {
      slot,
      state: "NEEDS_INPUT",
      sourceType: "placeholder_required",
      value: null,
      publishable: false,
      provenance: planningProvenanceFor(slot, input, section),
      lengthBudget: { maxCharacters }
    };
  }

  return {
    slot,
    state: "READY",
    sourceType: evidenceVerified ? "observed_fact" : "user_supplied_claim",
    value,
    publishable: true,
    provenance: authored
      ? [
          `compiler.authoredContent:${slot}`,
          `source:${authored.source.kind}:${authored.source.uri}`,
          ...(evidenceVerified ? [`evidence:${evidence.source}#sha256=${evidence.sha256}`] : [])
        ]
      : planningProvenanceFor(slot, input, section),
    lengthBudget: { maxCharacters }
  };
}

function qualityFor(fields: ContentFieldContract[]): SectionContentContract["quality"] {
  const publishable = fields.filter((field) => field.publishable && field.value).map((field) => field.value!);
  const forbiddenPhraseHits = EMPTY_MARKETING_PHRASES.filter((phrase) => publishable.some((value) => value.toLowerCase().includes(phrase)));
  const counts = new Map<string, number>();
  for (const value of publishable) counts.set(value, (counts.get(value) ?? 0) + 1);
  const repeatedPublishableValues = [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
  return { forbiddenPhraseHits, repeatedPublishableValues };
}

export function compileContentArchitecture(input: CompilerInput): ContentArchitecturePlan {
  const ia = compileInformationArchitecture(input);
  const forbidden = new Set(ia.forbiddenInventions);
  const requiredSlots = new Set(ia.sections.flatMap((section) => section.requiredContent));
  const unownedSlots = Object.keys(input.authoredContent ?? {}).filter((slot) => !requiredSlots.has(slot)).sort();
  if (unownedSlots.length > 0) {
    throw new Error(`authored content is not owned by this page architecture: ${unownedSlots.join(", ")}`);
  }
  const sections = ia.sections.map<SectionContentContract>((section) => {
    const fields = section.requiredContent.map((slot) => fieldFor(slot, input, section, forbidden));
    return {
      sectionId: section.id,
      sectionType: section.type,
      messageGoal: section.purpose,
      audienceQuestion: audienceQuestion(section, input.brief.audience),
      ctaRole: ctaRole(section),
      fallback: section.fallback,
      localePolicy: { sourceLocale: "en", localizationReady: true },
      fields,
      quality: qualityFor(fields)
    };
  });

  const qualityFailure = sections.some((section) => section.quality.forbiddenPhraseHits.length > 0 || section.quality.repeatedPublishableValues.length > 1);
  const needsInput = sections.some((section) => section.fields.some((field) => field.state === "NEEDS_INPUT"));
  return {
    schema: "website-design-compiler/content-architecture/v2",
    project: input.project,
    audience: input.brief.audience,
    objective: input.brief.objective,
    sections,
    forbiddenInventions: ia.forbiddenInventions,
    overall: qualityFailure || needsInput ? "NEEDS_INPUT" : "READY"
  };
}

export async function writeContentArchitecturePlan(input: CompilerInput, outputDirectory: string): Promise<StageExecutionEvidence> {
  const plan = compileContentArchitecture(input);
  await validateAgainstSchema(plan, "content-architecture-v2.schema.json");
  const directory = join(outputDirectory, "content-architecture");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "content-architecture.json");
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return {
    state: plan.overall === "READY" ? "PASS" : "ABSENT",
    reason: plan.overall === "READY"
      ? "Content Architecture emitted complete, provenance-bound authoring contracts."
      : "Required authoring inputs are absent; the artifact records explicit NEEDS_INPUT fields.",
    artifacts: [path]
  };
}
