export const SECTION_KINDS = [
  "navigation",
  "hero",
  "feature-grid",
  "bento-grid",
  "proof-cloud",
  "metrics",
  "testimonial",
  "comparison",
  "pricing",
  "faq",
  "cta",
  "footer",
  "editorial-prose",
  "editorial-media",
  "product-showcase",
  "media-stage",
  "graphics-2d-stage",
  "graphics-3d-stage"
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export type SectionFieldType = "text" | "rich-text" | "link" | "items" | "media" | "number";
export interface SectionFieldContract {
  type: SectionFieldType;
  required: boolean;
  provenanceRequired: boolean;
  maxLength?: number;
}
export interface SectionCompositionContract {
  placement: "PAGE_ROOT";
  allowedChildren: readonly [];
}
export interface GovernedSectionContract {
  kind: SectionKind;
  variants: readonly string[];
  fields: Readonly<Record<string, SectionFieldContract>>;
  composition: SectionCompositionContract;
  rawMarkupAllowed: false;
  tokenOwnership: "semantic-design-tokens/v2";
  claimPolicy: "CLAIM_SAFE" | "EVIDENCE_REQUIRED";
}
type SectionContractDefinition = Omit<GovernedSectionContract, "composition">;
const composition: SectionCompositionContract = { placement: "PAGE_ROOT", allowedChildren: [] };
const text = (
  required: boolean,
  maxLength: number,
  provenanceRequired = true
): SectionFieldContract => ({ type: "text", required, provenanceRequired, maxLength });
const items = (required: boolean, provenanceRequired = true): SectionFieldContract => ({
  type: "items",
  required,
  provenanceRequired
});
const media = (required = false): SectionFieldContract => ({
  type: "media",
  required,
  provenanceRequired: true
});
const SECTION_CONTRACT_DEFINITIONS:Readonly<Record<SectionKind,SectionContractDefinition>>={
  navigation: {
    kind: "navigation",
    variants: ["minimal", "product"],
    fields: {
      brand: text(true, 48),
      links: items(true),
      action: { type: "link", required: false, provenanceRequired: true }
    },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  hero: {
    kind: "hero",
    variants: ["text-first", "split-media", "interactive"],
    fields: {
      eyebrow: text(false, 48),
      headline: text(true, 96),
      body: text(true, 220),
      primaryAction: { type: "link", required: false, provenanceRequired: true },
      secondaryAction: { type: "link", required: false, provenanceRequired: true },
      media: media(false)
    },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  "feature-grid": {
    kind: "feature-grid",
    variants: ["cards", "rows", "icon-grid"],
    fields: { heading: text(true, 72), items: items(true) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  "bento-grid": {
    kind: "bento-grid",
    variants: ["balanced", "asymmetric"],
    fields: { heading: text(false, 72), items: items(true) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  "proof-cloud": {
    kind: "proof-cloud",
    variants: ["logos", "citations"],
    fields: { heading: text(false, 64), items: items(true, true) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "EVIDENCE_REQUIRED"
  },
  metrics: {
    kind: "metrics",
    variants: ["inline", "grid"],
    fields: { heading: text(false, 64), items: items(true, true) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "EVIDENCE_REQUIRED"
  },
  testimonial: {
    kind: "testimonial",
    variants: ["quote", "carousel-shell"],
    fields: { quote: text(true, 320, true), attribution: text(true, 96, true) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "EVIDENCE_REQUIRED"
  },
  comparison: {
    kind: "comparison",
    variants: ["table", "matrix"],
    fields: { heading: text(true, 72), items: items(true, true) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "EVIDENCE_REQUIRED"
  },
  pricing: {
    kind: "pricing",
    variants: ["tiers", "single-offer"],
    fields: { heading: text(true, 72), items: items(true, true) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "EVIDENCE_REQUIRED"
  },
  faq: {
    kind: "faq",
    variants: ["accordion", "list"],
    fields: { heading: text(true, 72), items: items(true) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  cta: {
    kind: "cta",
    variants: ["band", "split"],
    fields: {
      headline: text(true, 80),
      body: text(false, 180),
      action: { type: "link", required: true, provenanceRequired: true }
    },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  footer: {
    kind: "footer",
    variants: ["compact", "multi-column"],
    fields: { brand: text(true, 48), links: items(true), legal: text(false, 160) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  "editorial-prose": {
    kind: "editorial-prose",
    variants: ["article", "longform"],
    fields: {
      heading: text(false, 96),
      body: { type: "rich-text", required: true, provenanceRequired: true }
    },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  "editorial-media": {
    kind: "editorial-media",
    variants: ["figure", "gallery"],
    fields: { media: media(true), caption: text(false, 180) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  "product-showcase": {
    kind: "product-showcase",
    variants: ["split", "stage"],
    fields: { heading: text(true, 72), body: text(false, 180), media: media(true) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  "media-stage": {
    kind: "media-stage",
    variants: ["image", "video"],
    fields: { media: media(true), description: text(false, 180) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  "graphics-2d-stage": {
    kind: "graphics-2d-stage",
    variants: ["ambient", "interactive"],
    fields: { description: text(true, 180) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  },
  "graphics-3d-stage": {
    kind: "graphics-3d-stage",
    variants: ["product", "spatial"],
    fields: { description: text(true, 180) },
    rawMarkupAllowed: false,
    tokenOwnership: "semantic-design-tokens/v2",
    claimPolicy: "CLAIM_SAFE"
  }
};
export const SECTION_CONTRACTS: Readonly<Record<SectionKind, GovernedSectionContract>> =
  Object.fromEntries(
    SECTION_KINDS.map((kind) => [kind, { ...SECTION_CONTRACT_DEFINITIONS[kind], composition }])
  ) as unknown as Readonly<Record<SectionKind, GovernedSectionContract>>;
export interface SectionInstance { id:string; kind:SectionKind; variant:string; props:Record<string,unknown>; provenance:Record<string,string>; tokenRef:"semantic-design-tokens/v2"; }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function validateLink(field: string, value: unknown): string[] {
  if (!isRecord(value)) return [`${field} must be a link object`];
  const errors = unknownKeys(value, ["label", "href"]).map(
    (key) => `${field}.${key} is not approved`
  );
  if (!isNonEmptyText(value.label)) errors.push(`${field}.label must be non-empty text`);
  if (!isNonEmptyText(value.href)) errors.push(`${field}.href must be non-empty text`);
  else if (/^(?:javascript|data|vbscript):/i.test(value.href.trim())) {
    errors.push(`${field}.href uses a forbidden URL scheme`);
  }
  return errors;
}

function validateItems(field: string, value: unknown): string[] {
  if (!Array.isArray(value)) return [`${field} must be an array of text items`];
  const errors: string[] = [];
  for (const [index, item] of value.entries()) {
    if (isNonEmptyText(item)) continue;
    if (!isRecord(item)) {
      errors.push(`${field}[${index}] must be non-empty text or a value object`);
      continue;
    }
    for (const key of unknownKeys(item, ["value"])) {
      errors.push(`${field}[${index}].${key} is not approved`);
    }
    if (!isNonEmptyText(item.value)) {
      errors.push(`${field}[${index}].value must be non-empty text`);
    }
  }
  return errors;
}

function validateMedia(field: string, value: unknown): string[] {
  if (!isRecord(value)) return [`${field} must be a media object`];
  const errors = unknownKeys(value, ["assetId", "alt"]).map(
    (key) => `${field}.${key} is not approved`
  );
  if (!isNonEmptyText(value.assetId)) errors.push(`${field}.assetId must be non-empty text`);
  if (!isNonEmptyText(value.alt)) errors.push(`${field}.alt must be non-empty text`);
  return errors;
}

function validateField(field: string, rule: SectionFieldContract, value: unknown): string[] {
  if (value === undefined || value === null || value === "") {
    return rule.required ? [`missing required field ${field}`] : [];
  }
  if (rule.type === "text" || rule.type === "rich-text") {
    if (!isNonEmptyText(value)) return [`${field} must be text`];
    return rule.maxLength !== undefined && value.length > rule.maxLength
      ? [`field ${field} exceeds max length ${rule.maxLength}`]
      : [];
  }
  if (rule.type === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? []
      : [`${field} must be a finite number`];
  }
  if (rule.type === "link") return validateLink(field, value);
  if (rule.type === "items") {
    if (rule.required && Array.isArray(value) && value.length === 0) {
      return [`missing required field ${field}`];
    }
    return validateItems(field, value);
  }
  return validateMedia(field, value);
}

export function validateSectionInstance(instance: SectionInstance): string[] {
  if (!isRecord(instance)) return ["section instance must be an object"];
  const errors: string[] = [];
  for (const key of unknownKeys(instance, ["id", "kind", "variant", "props", "provenance", "tokenRef"])) {
    errors.push(`unknown section field ${key}`);
  }
  if (!isNonEmptyText(instance.id)) errors.push("id must be non-empty text");
  if (!isNonEmptyText(instance.kind) || !SECTION_KINDS.includes(instance.kind as SectionKind)) {
    errors.push(`unknown section kind: ${String(instance.kind)}`);
    return errors;
  }

  const contract = SECTION_CONTRACTS[instance.kind as SectionKind];
  if (!isNonEmptyText(instance.variant) || !contract.variants.includes(instance.variant)) {
    errors.push(`unsupported variant ${String(instance.variant)} for ${contract.kind}`);
  }
  if (instance.tokenRef !== contract.tokenOwnership) {
    errors.push(`tokenRef must reference ${contract.tokenOwnership}`);
  }

  const props = isRecord(instance.props) ? instance.props : {};
  if (!isRecord(instance.props)) errors.push("props must be an object");
  for (const key of unknownKeys(props, Object.keys(contract.fields))) {
    errors.push(`unknown prop ${key} for ${contract.kind}`);
  }
  if (props.html !== undefined || props.css !== undefined) {
    errors.push("raw markup/style escape hatch forbidden");
  }

  const provenance = isRecord(instance.provenance) ? instance.provenance : {};
  if (!isRecord(instance.provenance)) errors.push("provenance must be an object");
  for (const key of unknownKeys(provenance, Object.keys(contract.fields))) {
    errors.push(`unknown provenance field ${key}`);
  }

  for (const [field, rule] of Object.entries(contract.fields)) {
    const value = props[field];
    errors.push(...validateField(field, rule, value));
    if (value !== undefined && rule.provenanceRequired && !isNonEmptyText(provenance[field])) {
      errors.push(`provenance.${field} must be non-empty text`);
      errors.push(`missing provenance for ${field}`);
    }
  }
  return errors;
}

export function sectionRegistryProjection() {
  return SECTION_KINDS.map((kind) => ({
    kind,
    variants: [...SECTION_CONTRACTS[kind].variants],
    fieldNames: Object.keys(SECTION_CONTRACTS[kind].fields).sort(),
    composition: SECTION_CONTRACTS[kind].composition,
    claimPolicy: SECTION_CONTRACTS[kind].claimPolicy,
    rawMarkupAllowed: false as const,
    tokenOwnership: "semantic-design-tokens/v2" as const
  }));
}
