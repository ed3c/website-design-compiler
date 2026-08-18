import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_CONTRACTS, SECTION_KINDS, sectionRegistryProjection, validateSectionInstance, type SectionInstance } from "../src/section-grammar.js";

const EXPECTED_SECTION_KINDS = [
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

test("rich registry contains at least fifteen governed section contracts", () => {
  assert.deepEqual(SECTION_KINDS, EXPECTED_SECTION_KINDS);
  assert.equal(new Set(SECTION_KINDS).size, SECTION_KINDS.length);
  for (const kind of SECTION_KINDS) {
    const contract = SECTION_CONTRACTS[kind];
    assert.equal(contract.rawMarkupAllowed, false);
    assert.equal(contract.tokenOwnership, "semantic-design-tokens/v2");
    assert.deepEqual(contract.composition, { placement: "PAGE_ROOT", allowedChildren: [] });
    assert.ok(contract.variants.length > 0);
    assert.ok(Object.keys(contract.fields).length > 0);
  }
});

test("canonical section validation enforces runtime field types and token identity", () => {
  const invalid = {
    id: "hero",
    kind: "hero",
    variant: "text-first",
    props: {
      headline: ["not text"],
      body: "Valid body",
      primaryAction: { label: "Go", href: "/go", style: "position: fixed" }
    },
    provenance: {
      headline: "compiler.authoredContent:headline",
      body: "compiler.authoredContent:body",
      primaryAction: "compiler.authoredContent:primary-action"
    },
    tokenRef: "raw-color-token"
  } as unknown as SectionInstance;

  const errors = validateSectionInstance(invalid);
  assert.ok(errors.some((error) => error.includes("headline must be text")));
  assert.ok(errors.some((error) => error.includes("primaryAction.style is not approved")));
  assert.ok(errors.some((error) => error.includes("tokenRef must reference semantic-design-tokens/v2")));
});

test("canonical section validation rejects untyped item media and provenance payloads", () => {
  const invalid = {
    id: "showcase",
    kind: "product-showcase",
    variant: "split",
    props: {
      heading: "Product",
      media: { assetId: 42, alt: "Product", html: "<img>" }
    },
    provenance: {
      heading: "compiler.authoredContent:heading",
      media: 42,
      unknown: "drift"
    },
    tokenRef: "semantic-design-tokens/v2"
  } as unknown as SectionInstance;

  const errors = validateSectionInstance(invalid);
  assert.ok(errors.some((error) => error.includes("media.assetId must be non-empty text")));
  assert.ok(errors.some((error) => error.includes("media.html is not approved")));
  assert.ok(errors.some((error) => error.includes("provenance.media must be non-empty text")));
  assert.ok(errors.some((error) => error.includes("unknown provenance field unknown")));
});

test("evidence-bearing commercial and social-proof sections fail without provenance", () => {
  for (const kind of ["proof-cloud", "metrics", "testimonial", "comparison", "pricing"] as const) {
    assert.equal(SECTION_CONTRACTS[kind].claimPolicy, "EVIDENCE_REQUIRED");
  }
  const invalid: SectionInstance = { id:"proof", kind:"metrics", variant:"grid", props:{items:[{value:"99%"}]}, provenance:{}, tokenRef:"semantic-design-tokens/v2" };
  assert.ok(validateSectionInstance(invalid).some((error) => error.includes("missing provenance for items")));
});

test("unknown props variants and raw markup fail closed", () => {
  const invalid = { id:"hero", kind:"hero", variant:"clone", props:{headline:"Hello",body:"World",primaryAction:{label:"Run",href:"javascript:alert(1)"},html:"<script>"}, provenance:{headline:"brief",body:"brief",primaryAction:"brief",html:"unsafe"}, tokenRef:"semantic-design-tokens/v2" } as unknown as SectionInstance;
  const errors = validateSectionInstance(invalid);
  assert.ok(errors.some((error) => error.includes("unsupported variant")));
  assert.ok(errors.some((error) => error.includes("unknown prop html")));
  assert.ok(errors.some((error) => error.includes("raw markup/style escape hatch forbidden")));
  assert.ok(errors.some((error) => error.includes("forbidden URL scheme")));
});

test("canonical projection is deterministic and complete", () => {
  const first = sectionRegistryProjection();
  const second = sectionRegistryProjection();
  assert.deepEqual(first, second);
  assert.equal(first.length, SECTION_KINDS.length);
  assert.deepEqual(first.map((entry) => entry.kind), [...SECTION_KINDS]);
});
