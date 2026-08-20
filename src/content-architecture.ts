import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { CompilerInput, StageExecutionEvidence } from "./contracts.js";
import { compileInformationArchitecture, type IaSection } from "./information-architecture.js";
import { maxCharactersForContentSlot, qualityForContentFields, validContentValue, validateSectionContentContract, type ContentFieldContract, type ContentValue, type SectionContentContract } from "./content-contract.js";
import { validateAgainstSchema } from "./validate.js";
export { validateSectionContentContract } from "./content-contract.js";
export type { ContentFieldContract, ContentFieldState, ContentSourceType, ContentValue, SectionContentContract } from "./content-contract.js";

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

function scopedContentValue(input: CompilerInput, section: IaSection, slot: string): ContentValue | undefined {
  if (input.contentEvidence?.source !== "USER_SUPPLIED") return undefined;
  const fields = input.contentEvidence.sections[section.id];
  if (!fields || !Object.hasOwn(fields, slot)) return undefined;
  return structuredClone(fields[slot]);
}

function audienceQuestion(section: IaSection, audience: string): string {
  return `What does ${audience} need to understand from ${section.id}?`;
}

function ctaRole(section: IaSection): "PRIMARY" | "SECONDARY" | "NONE" {
  if (section.id === "navigation" || section.id === "conversion") return "PRIMARY";
  if (section.id.includes("hero")) return "SECONDARY";
  return "NONE";
}

function evidenceSha256(source: string, sourceSha256: string, excerpt: string, value: string): string {
  return createHash("sha256").update(`${source}\0${sourceSha256}\0${excerpt}\0${value}`).digest("hex");
}

function workspaceEvidenceBytes(root: string, path: string): Buffer | null {
  if (isAbsolute(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  try {
    const canonicalRoot = realpathSync(root);
    const resolved = realpathSync(resolve(canonicalRoot, path));
    const traversal = relative(canonicalRoot, resolved);
    if (traversal.split(/[\\/]/)[0] === ".." || isAbsolute(traversal)) return null;
    return readFileSync(resolved);
  } catch {
    return null;
  }
}

function fieldFor(slot: string, input: CompilerInput, section: IaSection, forbidden: Set<string>, root: string): ContentFieldContract {
  const maxCharacters = maxCharactersForContentSlot(slot, section.type);
  const authored = input.authoredContent?.[slot];
  const authoredValue = authored?.value;
  const scopedValue = scopedContentValue(input, section, slot);
  if (scopedValue !== undefined && authoredValue !== undefined && JSON.stringify(scopedValue) !== JSON.stringify(authoredValue)) {
    throw new Error(`conflicting content sources for ${section.id}.${slot}`);
  }
  const evidence = authored?.evidence;
  const authoredText = Array.isArray(authoredValue) ? authoredValue.join("; ") : authoredValue;
  const evidenceBytes = evidence ? workspaceEvidenceBytes(root, evidence.source) : null;
  const evidenceText = evidenceBytes?.toString("utf8");
  const sourceSha256 = evidenceBytes ? createHash("sha256").update(evidenceBytes).digest("hex") : null;
  const evidenceVerified = evidence !== undefined &&
    authored !== undefined &&
    evidence.source === authored.source.uri &&
    sourceSha256 === evidence.sourceSha256 &&
    evidenceText?.includes(evidence.excerpt) === true &&
    authoredText !== undefined &&
    evidence.excerpt.toLocaleLowerCase("en").includes(authoredText.toLocaleLowerCase("en")) &&
    evidence.sha256 === evidenceSha256(evidence.source, evidence.sourceSha256, evidence.excerpt, authoredText);
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

  const projectValue = slot === "brand-or-project-name" || slot === "project-name" ? input.project : undefined;
  const value: ContentValue | undefined = scopedValue ?? authoredValue ?? projectValue;
  if (value === undefined || !validContentValue(slot, value, maxCharacters)) {
    return {
      slot,
      state: "NEEDS_INPUT",
      sourceType: "placeholder_required",
      value: null,
      publishable: false,
      provenance: [],
      lengthBudget: { maxCharacters }
    };
  }

  return {
    slot,
    state: "READY",
    sourceType: evidenceVerified ? "observed_fact" : "user_supplied_claim",
    value,
    publishable: true,
    provenance: scopedValue !== undefined
      ? [`brief-input:${input.briefSourceEvidence!.inputSha256}#/contentEvidence/sections/${section.id}/${slot}`]
      : authored
      ? [
          `compiler.authoredContent:${slot}`,
          `source:${authored.source.kind}:${authored.source.uri}`,
          ...(evidenceVerified ? [`evidence:${evidence.source}#sha256=${evidence.sha256}`] : [])
        ]
      : [`compiler.project:${input.project}`],
    lengthBudget: { maxCharacters }
  };
}

export function compileContentArchitecture(input: CompilerInput, root = process.cwd()): ContentArchitecturePlan {
  const ia = compileInformationArchitecture(input);
  if(input.contentEvidence){
    if(input.contentEvidence.schema!=="website-design-compiler/content-evidence/v1"||input.contentEvidence.source!=="USER_SUPPLIED")throw new Error("content evidence identity is invalid");
    if(!input.briefSourceEvidence)throw new Error("content evidence requires exact brief source evidence");
    const sectionsById=new Map(ia.sections.map((section)=>[section.id,section]));
    for(const [sectionId,fields] of Object.entries(input.contentEvidence.sections)){
      const section=sectionsById.get(sectionId);if(!section)throw new Error(`content evidence references unknown section ${sectionId}`);
      for(const slot of Object.keys(fields))if(!section.requiredContent.includes(slot))throw new Error(`content evidence references unknown slot ${sectionId}.${slot}`);
    }
  }
  const forbidden = new Set(ia.forbiddenInventions);
  const requiredSlots = new Set(ia.sections.flatMap((section) => section.requiredContent));
  const unownedSlots = Object.keys(input.authoredContent ?? {})
    .filter((slot) => !requiredSlots.has(slot))
    .sort();
  if (unownedSlots.length > 0) {
    throw new Error(`authored content is not owned by this page architecture: ${unownedSlots.join(", ")}`);
  }
  const sections = ia.sections.map<SectionContentContract>((section) => {
    const fields = section.requiredContent.map((slot) => fieldFor(slot, input, section, forbidden, root));
    return {
      sectionId: section.id,
      sectionType: section.type,
      messageGoal: section.purpose,
      audienceQuestion: audienceQuestion(section, input.brief.audience),
      ctaRole: ctaRole(section),
      fallback: section.fallback,
      localePolicy: { sourceLocale: "en", localizationReady: true },
      fields,
      quality: qualityForContentFields(fields)
    };
  });

  const qualityFailure = sections.some((section) => section.quality.forbiddenPhraseHits.length > 0 || section.quality.repeatedPublishableValues.length > 0);
  const needsInput = sections.some((section) => section.fields.some((field) => field.state === "NEEDS_INPUT"));
  const contractErrors=sections.flatMap((section)=>validateSectionContentContract(section).map((error)=>`${section.sectionId}: ${error}`));
  if(contractErrors.length>0)throw new Error(`invalid content architecture: ${contractErrors.join("; ")}`);
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
