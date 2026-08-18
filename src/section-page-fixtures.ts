import { ARENA_CATEGORIES, type ArenaCategory } from "./arena.js";
import { compileContentArchitecture, type SectionContentContract } from "./content-architecture.js";
import type { CompilerInput } from "./contracts.js";
import { compileInformationArchitecture, type IaSection } from "./information-architecture.js";
import {
  SECTION_CONTRACTS,
  validateSectionInstance,
  type SectionInstance,
  type SectionKind
} from "./section-grammar.js";

export const SECTION_PAGE_CATEGORIES = ARENA_CATEGORIES;
export type SectionPageCategory = ArenaCategory;

export interface CompiledSectionPage {
  schema: "website-design-compiler/section-page/v2";
  category: SectionPageCategory;
  project: string;
  source: {
    input: "website-design-compiler/input/v1";
    informationArchitecture: "website-design-compiler/information-architecture/v2";
    contentArchitecture: "website-design-compiler/content-architecture/v2";
  };
  sections: SectionInstance[];
  missingEvidence: string[];
}

/** Compatibility name for downstream page-graph compilers. The value is compiler output, not a fixture. */
export type SectionPageFixture = CompiledSectionPage;

type SectionProjection = {
  kind: SectionKind;
  variant: string;
  props: Record<string, unknown>;
  provenance: Record<string, string>;
  missingEvidence: string[];
};

type ResolvedValue = {
  value: string;
  provenance: string;
  missingEvidence: string[];
};

function categoryForFamily(family: string): ArenaCategory {
  if (family === "premium-consumer") return "premium-consumer-brand";
  if (ARENA_CATEGORIES.includes(family as ArenaCategory)) return family as ArenaCategory;
  throw new Error(`unsupported compiler page family: ${family}`);
}

function bounded(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters ? value : value.slice(0, maxCharacters).trimEnd();
}

function resolveValue(
  section: SectionContentContract,
  slots: readonly string[],
  fallback: string,
  maxCharacters: number
): ResolvedValue {
  const ownedFields = slots.flatMap((slot) => {
    const field = section.fields.find((candidate) => candidate.slot === slot);
    return field ? [field] : [];
  });
  const field = ownedFields
    .find((candidate) => candidate?.state === "READY" && candidate.value);
  if (field?.value) {
    return {
      value: bounded(field.value, maxCharacters),
      provenance: field.provenance.join("|") || `content-architecture:${section.sectionId}`,
      missingEvidence: []
    };
  }
  return {
    value: bounded(fallback, maxCharacters),
    provenance: `ia.fallback:${section.sectionId}`,
    missingEvidence: ownedFields.map((candidate) => `${section.sectionId}.${candidate.slot}`)
  };
}

function itemsFrom(value: ResolvedValue): string[] {
  const values = value.value
    .split(/\s*[;|]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : [value.value];
}

function linkFrom(value: ResolvedValue, href: string): { label: string; href: string } {
  return { label: bounded(value.value, 36), href };
}

function mediaFrom(asset: ResolvedValue, alt: ResolvedValue): { assetId: string; alt: string } {
  return { assetId: asset.value, alt: alt.value };
}

function projectSection(
  iaSection: IaSection,
  content: SectionContentContract,
  input: CompilerInput,
  allSections: readonly IaSection[]
): SectionProjection {
  const fallback = iaSection.fallback;
  const project = {
    value: bounded(input.project, 48),
    provenance: `compiler.project:${input.project}`,
    missingEvidence: []
  };
  const action = resolveValue(
    content,
    ["primary-action", "primary-action-label", "cta-label"],
    "Continue",
    36
  );
  const headline = resolveValue(content, ["headline"], content.messageGoal, 96);
  const body = resolveValue(
    content,
    ["value-proposition", "dek", "task"],
    content.messageGoal,
    220
  );
  const heading = {
    value: bounded(content.messageGoal, 72),
    provenance: `information-architecture:${iaSection.id}`,
    missingEvidence: []
  };

  if (iaSection.type === "navigation") {
    const links = allSections.slice(1, -1).map((entry) => entry.id);
    return {
      kind: "navigation",
      variant: "minimal",
      props: { brand: project.value, links, action: linkFrom(action, "#conversion") },
      provenance: {
        brand: project.provenance,
        links: "compiler.informationArchitecture:navigation",
        action: action.provenance
      },
      missingEvidence: action.missingEvidence
    };
  }

  if (iaSection.type.startsWith("hero-")) {
    const variant = iaSection.type === "hero-interactive" || iaSection.type === "hero-creative"
      ? "interactive"
      : iaSection.type === "hero-premium"
        ? "split-media"
        : "text-first";
    return {
      kind: "hero",
      variant,
      props: {
        headline: headline.value,
        body: body.value,
        primaryAction: linkFrom(action, "#conversion")
      },
      provenance: {
        headline: headline.provenance,
        body: body.provenance,
        primaryAction: action.provenance
      },
      missingEvidence: [
        ...headline.missingEvidence,
        ...body.missingEvidence,
        ...action.missingEvidence
      ]
    };
  }

  if (iaSection.type === "feature-grid") {
    const items = resolveValue(content, ["feature-items"], fallback, 280);
    return {
      kind: "feature-grid",
      variant: "cards",
      props: { heading: heading.value, items: itemsFrom(items) },
      provenance: { heading: heading.provenance, items: items.provenance },
      missingEvidence: items.missingEvidence
    };
  }

  if (iaSection.type === "proof") {
    const items = resolveValue(content, ["proof-items"], fallback, 280);
    return {
      kind: "proof-cloud",
      variant: "citations",
      props: { heading: "Evidence", items: itemsFrom(items) },
      provenance: { heading: heading.provenance, items: items.provenance },
      missingEvidence: items.missingEvidence
    };
  }

  if (iaSection.type === "cta-band") {
    return {
      kind: "cta",
      variant: "band",
      props: { headline: bounded(content.messageGoal, 80), action: linkFrom(action, "#navigation") },
      provenance: { headline: heading.provenance, action: action.provenance },
      missingEvidence: action.missingEvidence
    };
  }

  if (iaSection.type === "footer") {
    return {
      kind: "footer",
      variant: "compact",
      props: { brand: project.value, links: allSections.slice(0, -1).map((entry) => entry.id) },
      provenance: {
        brand: project.provenance,
        links: "compiler.informationArchitecture:footer"
      },
      missingEvidence: []
    };
  }

  if (iaSection.type === "editorial-prose") {
    const prose = resolveValue(content, ["body-content"], fallback, 280);
    return {
      kind: "editorial-prose",
      variant: "article",
      props: { heading: bounded(content.messageGoal, 96), body: prose.value },
      provenance: { heading: heading.provenance, body: prose.provenance },
      missingEvidence: prose.missingEvidence
    };
  }

  if (iaSection.type === "editorial-media") {
    const asset = resolveValue(
      content,
      ["editorial-media-asset-id"],
      `unresolved-${iaSection.id}`,
      280
    );
    const alt = resolveValue(content, ["editorial-media-alt"], fallback, 180);
    return {
      kind: "editorial-media",
      variant: "figure",
      props: { media: mediaFrom(asset, alt) },
      provenance: { media: `${asset.provenance}|${alt.provenance}` },
      missingEvidence: [...asset.missingEvidence, ...alt.missingEvidence]
    };
  }

  if (iaSection.type === "product-showcase") {
    const description = resolveValue(content, ["product-description"], fallback, 180);
    const asset = resolveValue(
      content,
      ["product-media-asset-id"],
      `unresolved-${iaSection.id}`,
      280
    );
    const alt = resolveValue(content, ["product-media-alt"], fallback, 180);
    return {
      kind: "product-showcase",
      variant: "split",
      props: {
        heading: heading.value,
        body: description.value,
        media: mediaFrom(asset, alt)
      },
      provenance: {
        heading: heading.provenance,
        body: description.provenance,
        media: `${asset.provenance}|${alt.provenance}`
      },
      missingEvidence: [
        ...description.missingEvidence,
        ...asset.missingEvidence,
        ...alt.missingEvidence
      ]
    };
  }

  if (iaSection.type === "bento-grid") {
    const items = resolveValue(content, ["story-beats"], fallback, 280);
    return {
      kind: "bento-grid",
      variant: "asymmetric",
      props: { heading: heading.value, items: itemsFrom(items) },
      provenance: { heading: heading.provenance, items: items.provenance },
      missingEvidence: items.missingEvidence
    };
  }

  if (iaSection.type === "media-stage") {
    const description = resolveValue(content, ["interaction-purpose"], fallback, 180);
    const asset = resolveValue(
      content,
      ["stage-media-asset-id"],
      `unresolved-${iaSection.id}`,
      280
    );
    const alt = resolveValue(content, ["stage-media-alt"], fallback, 180);
    return {
      kind: "media-stage",
      variant: "video",
      props: { media: mediaFrom(asset, alt), description: description.value },
      provenance: {
        media: `${asset.provenance}|${alt.provenance}`,
        description: description.provenance
      },
      missingEvidence: [
        ...description.missingEvidence,
        ...asset.missingEvidence,
        ...alt.missingEvidence
      ]
    };
  }

  if (iaSection.type === "graphics-2d-stage" || iaSection.type === "graphics-3d-stage") {
    const description = resolveValue(content, ["scene-purpose"], fallback, 180);
    return {
      kind: iaSection.type,
      variant: iaSection.type === "graphics-2d-stage" ? "interactive" : "spatial",
      props: { description: description.value },
      provenance: { description: description.provenance },
      missingEvidence: description.missingEvidence
    };
  }

  throw new Error(`unsupported IA section type ${iaSection.type} at ${iaSection.id}`);
}

export function compileSectionPage(input: CompilerInput): CompiledSectionPage {
  const informationArchitecture = compileInformationArchitecture(input);
  const contentArchitecture = compileContentArchitecture(input);
  const contentById = new Map(
    contentArchitecture.sections.map((section) => [section.sectionId, section])
  );
  const projected = informationArchitecture.sections.map((iaSection) => {
    const content = contentById.get(iaSection.id);
    if (!content) throw new Error(`missing content architecture section ${iaSection.id}`);
    return projectSection(iaSection, content, input, informationArchitecture.sections);
  });
  const sections = projected.map<SectionInstance>((entry, index) => ({
    id: `${String(index + 1).padStart(2, "0")}-${entry.kind}`,
    kind: entry.kind,
    variant: entry.variant,
    props: entry.props,
    provenance: entry.provenance,
    tokenRef: "semantic-design-tokens/v2"
  }));
  for (const section of sections) {
    const errors = validateSectionInstance(section);
    if (errors.length > 0) {
      throw new Error(`compiler emitted invalid ${section.kind} section: ${errors.join("; ")}`);
    }
  }
  return {
    schema: "website-design-compiler/section-page/v2",
    category: categoryForFamily(informationArchitecture.family),
    project: input.project,
    source: {
      input: input.schema,
      informationArchitecture: informationArchitecture.schema,
      contentArchitecture: contentArchitecture.schema
    },
    sections,
    missingEvidence: [...new Set(projected.flatMap((entry) => entry.missingEvidence))].sort()
  };
}

function benchmarkValue(category: ArenaCategory, slot: string): string {
  if (slot.includes("asset-id")) return `${category}-${slot}`;
  if (slot.endsWith("-alt")) return `Approved media for ${category}`;
  if (slot.includes("action") || slot.includes("cta")) return "Explore";
  if (slot.includes("items") || slot.includes("beats")) {
    return `Supplied ${slot} A for ${category}; Supplied ${slot} B for ${category}`;
  }
  return `Supplied ${slot} for ${category}`;
}

function benchmarkInput(category: ArenaCategory): CompilerInput {
  const base: CompilerInput = {
    schema: "website-design-compiler/input/v1",
    project: `arena-${category}`,
    brief: {
      pageType: category,
      audience: `benchmark audience for ${category}`,
      objective: `compile the governed ${category} experience`
    },
    requestedStages: ["information-architecture", "content-architecture", "frontend-builder"]
  };
  const requiredSlots = compileInformationArchitecture(base).sections
    .flatMap((section) => section.requiredContent)
    .filter((slot) => slot !== "brand-or-project-name" && slot !== "project-name");
  return {
    ...base,
    authoredContent: Object.fromEntries(
      [...new Set(requiredSlots)].map((slot) => [slot, benchmarkValue(category, slot)])
    )
  };
}

export function compileSectionPageFixture(category: SectionPageCategory): CompiledSectionPage {
  return compileSectionPage(benchmarkInput(category));
}

export function compileArenaSectionPages(): CompiledSectionPage[] {
  return ARENA_CATEGORIES.map(compileSectionPageFixture);
}

export function compileAllSectionPageFixtures(): CompiledSectionPage[] {
  return compileArenaSectionPages();
}
