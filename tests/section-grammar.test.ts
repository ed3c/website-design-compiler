import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_CONTRACTS, SECTION_KINDS, sectionRegistryProjection, validateSectionInstance, type SectionInstance } from "../src/section-grammar.js";

test("rich registry contains at least fifteen governed section contracts", () => {
  assert.ok(SECTION_KINDS.length >= 15);
  assert.equal(new Set(SECTION_KINDS).size, SECTION_KINDS.length);
  for (const kind of SECTION_KINDS) {
    const contract = SECTION_CONTRACTS[kind];
    assert.equal(contract.rawMarkupAllowed, false);
    assert.equal(contract.tokenOwnership, "semantic-design-tokens/v2");
    assert.ok(contract.variants.length > 0);
    assert.ok(Object.keys(contract.fields).length > 0);
  }
});

test("evidence-bearing commercial and social-proof sections fail without provenance", () => {
  for (const kind of ["proof-cloud", "metrics", "testimonial", "comparison", "pricing"] as const) {
    assert.equal(SECTION_CONTRACTS[kind].claimPolicy, "EVIDENCE_REQUIRED");
  }
  const invalid: SectionInstance = { id:"proof", kind:"metrics", variant:"grid", props:{items:[{value:"99%"}]}, provenance:{}, tokenRef:"semantic-design-tokens/v2" };
  assert.ok(validateSectionInstance(invalid).some((error) => error.includes("missing provenance for items")));
});

test("unknown props variants and raw markup fail closed", () => {
  const invalid = { id:"hero", kind:"hero", variant:"clone", props:{headline:"Hello",body:"World",primaryAction:{href:"/"},html:"<script>"}, provenance:{headline:"brief",body:"brief",primaryAction:"brief",html:"unsafe"}, tokenRef:"semantic-design-tokens/v2" } as unknown as SectionInstance;
  const errors = validateSectionInstance(invalid);
  assert.ok(errors.some((error) => error.includes("unsupported variant")));
  assert.ok(errors.some((error) => error.includes("unknown prop html")));
  assert.ok(errors.some((error) => error.includes("raw markup/style escape hatch forbidden")));
});

test("canonical projection is deterministic and complete", () => {
  const first = sectionRegistryProjection();
  const second = sectionRegistryProjection();
  assert.deepEqual(first, second);
  assert.equal(first.length, SECTION_KINDS.length);
  assert.deepEqual(first.map((entry) => entry.kind), [...SECTION_KINDS]);
});
