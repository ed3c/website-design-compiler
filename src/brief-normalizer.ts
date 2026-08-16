import { createHash } from "node:crypto";
import type { CompilerInput, CompilerReference } from "./contracts.js";

export const BRIEF_NORMALIZER_VERSION = "2.0.0";
export const BRIEF_NORMALIZER_CONFIG = "deterministic-regex-v1";

export type NormalizedFieldState = "EXPLICIT" | "INFERRED" | "NEEDS_INPUT";

export interface NaturalLanguageBriefInput {
  schema: "website-design-compiler/brief-input/v2";
  project: string;
  briefText: string;
  references?: CompilerReference[];
  hardConstraints?: string[];
  requestedStages?: string[];
}

export interface NormalizedField {
  value: string | null;
  state: NormalizedFieldState;
  sourceExcerpt: string | null;
}

export interface BriefNormalizationReceipt {
  schema: "website-design-compiler/brief-normalization/v2";
  project: string;
  inputSha256: string;
  structuredContractSha256: string | null;
  normalizer: {
    version: string;
    config: string;
  };
  state: "READY" | "NEEDS_INPUT";
  fields: {
    pageType: NormalizedField;
    audience: NormalizedField;
    objective: NormalizedField;
  };
  hardConstraints: string[];
  needsInput: string[];
  riskyContentRequests: string[];
  validationErrors: string[];
  compilerInput: CompilerInput | null;
}

const PAGE_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(b2b|saas|product)\b.*\b(landing|website|site|page)\b/i, "b2b-product"],
  [/\b(editorial|magazine|publication|news)\b/i, "editorial"],
  [/\b(premium|luxury|consumer brand|brand site)\b/i, "premium-consumer"],
  [/\b(motion[- ]heavy|creative site|immersive)\b/i, "motion-heavy-creative"],
  [/\b(2d|pixi|canvas)\b.*\b(interactive|experience|site)\b/i, "interactive-2d"],
  [/\b(3d|three\.js|r3f|webgl|webgpu)\b.*\b(interactive|experience|site|showcase)\b/i, "interactive-3d"],
  [/\b(landing page|landing site)\b/i, "product-landing"]
];

const RISKY_CONTENT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(testimonials?|customer quotes?|case stud(?:y|ies))\b/i, "testimonials"],
  [/\b(customer logos?|logo clouds?|trusted by)\b/i, "customer-logos"],
  [/\b(metrics?|kpis?|conversion rates?|performance numbers?|usage numbers?)\b/i, "metrics"],
  [/\b(pricing|prices?|plan tiers?)\b/i, "pricing"]
];

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function explicitLine(text: string, label: string): NormalizedField | null {
  const match = text.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"));
  if (!match?.[1]?.trim()) return null;
  return { value: match[1].trim(), state: "EXPLICIT", sourceExcerpt: match[0].trim() };
}

function inferPageType(text: string): NormalizedField {
  const explicit = explicitLine(text, "page type");
  if (explicit) return explicit;
  for (const [pattern, value] of PAGE_TYPE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { value, state: "INFERRED", sourceExcerpt: match[0] };
  }
  return { value: null, state: "NEEDS_INPUT", sourceExcerpt: null };
}

function inferAudience(text: string): NormalizedField {
  const explicit = explicitLine(text, "audience");
  if (explicit) return explicit;
  const match = text.match(/\bfor\s+([^.!?\n]{3,100}?)(?:\s+who\b|\s+that\b|[.!?\n]|$)/i);
  if (match?.[1]?.trim()) return { value: match[1].trim(), state: "INFERRED", sourceExcerpt: match[0].trim() };
  return { value: null, state: "NEEDS_INPUT", sourceExcerpt: null };
}

function inferObjective(text: string): NormalizedField {
  const explicit = explicitLine(text, "objective");
  if (explicit) return explicit;
  const match = text.match(/\b(?:goal|objective|so that|to)\s+(?:is\s+to\s+)?([^.!?\n]{6,160})/i);
  if (match?.[1]?.trim()) return { value: match[1].trim(), state: "INFERRED", sourceExcerpt: match[0].trim() };
  return { value: null, state: "NEEDS_INPUT", sourceExcerpt: null };
}

function collectConstraints(input: NaturalLanguageBriefInput): string[] {
  const fromInput = input.hardConstraints ?? [];
  const fromText = input.briefText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(must|must not|do not|never|requirement)\b/i.test(line));
  return [...new Set([...fromInput, ...fromText])];
}

function collectRiskyContentRequests(text: string): string[] {
  const positiveText = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(must not|do not|never|forbid|without)\b/i.test(line))
    .join("\n");
  return RISKY_CONTENT_PATTERNS.filter(([pattern]) => pattern.test(positiveText)).map(([, label]) => label);
}

function normalizedConstraintSubject(value: string): { polarity: "ALLOW" | "DENY"; subject: string } | null {
  const trimmed = value.trim().replace(/[.!]+$/, "");
  const negative = trimmed.match(/^(?:must not|do not|never)\s+(?:use|include|enable|allow|require|show)?\s*(.+)$/i);
  if (negative?.[1]?.trim()) {
    return { polarity: "DENY", subject: negative[1].trim().toLowerCase().replace(/\s+/g, " ") };
  }
  const positive = trimmed.match(/^(?:must|requirement:?\s*must)\s+(?:use|include|enable|allow|require|show|preserve|support)?\s*(.+)$/i);
  if (positive?.[1]?.trim()) {
    return { polarity: "ALLOW", subject: positive[1].trim().toLowerCase().replace(/\s+/g, " ") };
  }
  return null;
}

function detectConstraintContradictions(constraints: string[]): string[] {
  const directives = constraints
    .map((constraint) => ({ constraint, directive: normalizedConstraintSubject(constraint) }))
    .filter((entry): entry is { constraint: string; directive: { polarity: "ALLOW" | "DENY"; subject: string } } => Boolean(entry.directive));
  const errors: string[] = [];
  for (const entry of directives) {
    const opposite = directives.find((candidate) =>
      candidate.directive.subject === entry.directive.subject && candidate.directive.polarity !== entry.directive.polarity
    );
    if (opposite) {
      errors.push(`Contradictory hard constraints for \"${entry.directive.subject}\": \"${entry.constraint}\" conflicts with \"${opposite.constraint}\".`);
    }
  }
  return [...new Set(errors)].sort();
}

export function normalizeBrief(input: NaturalLanguageBriefInput): BriefNormalizationReceipt {
  if (!input.project.trim()) throw new Error("project is required");
  if (!input.briefText.trim()) throw new Error("briefText is required");

  const pageType = inferPageType(input.briefText);
  const audience = inferAudience(input.briefText);
  const objective = inferObjective(input.briefText);
  const fields = { pageType, audience, objective };
  const needsInput = Object.entries(fields)
    .filter(([, field]) => field.state === "NEEDS_INPUT")
    .map(([name]) => name);
  const riskyContentRequests = collectRiskyContentRequests(input.briefText);
  const hardConstraints = collectConstraints(input);
  const validationErrors = detectConstraintContradictions(hardConstraints);

  for (const risky of riskyContentRequests) needsInput.push(`evidence:${risky}`);
  if (validationErrors.length > 0) needsInput.push("hardConstraints");

  const state = needsInput.length === 0 ? "READY" : "NEEDS_INPUT";
  const requestedStages = input.requestedStages ?? [
    "reference-intelligence",
    "art-direction",
    "information-architecture",
    "content-architecture",
    "design-system-compiler",
    "page-architect",
    "frontend-builder",
    "release-receipt"
  ];

  const compilerInput: CompilerInput | null = state === "READY"
    ? {
        schema: "website-design-compiler/input/v1",
        project: input.project,
        brief: {
          pageType: pageType.value!,
          audience: audience.value!,
          objective: objective.value!
        },
        ...(input.references ? { references: input.references } : {}),
        requestedStages
      }
    : null;

  return {
    schema: "website-design-compiler/brief-normalization/v2",
    project: input.project,
    inputSha256: hash(input),
    structuredContractSha256: compilerInput ? hash(compilerInput) : null,
    normalizer: {
      version: BRIEF_NORMALIZER_VERSION,
      config: BRIEF_NORMALIZER_CONFIG
    },
    state,
    fields,
    hardConstraints,
    needsInput: [...new Set(needsInput)],
    riskyContentRequests,
    validationErrors,
    compilerInput
  };
}
