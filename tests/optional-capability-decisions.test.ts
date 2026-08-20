import assert from "node:assert/strict";
import test from "node:test";
import { createOptionalCapabilityDecisionPacket, decisionMayOpenImplementationDag } from "../src/optional-capability-decisions.js";
import { validateAgainstSchema } from "../src/validate.js";

const h = (value: string) => value.repeat(64).slice(0, 64);
const evidence = [{ sourceIdentitySha256: h("a"), observationIdentitySha256: h("b") }];

test("DEFER decision remains machine-ineligible and schema valid", async () => {
  const packet = createOptionalCapabilityDecisionPacket({
    track: "THREE_D_PRODUCT_PHOTOSHOOT",
    decision: "DEFER",
    rationale: "The current website compiler core does not require a photoshoot provider to preserve semantic page behavior.",
    evidenceAnchors: evidence,
    requiredPrerequisites: ["measured product requirement", "exact technology admission"],
    blockedByIssues: [47, 48, 25],
    requiredFallbacks: ["static product image", "semantic DOM content"],
    dependencyAdmissionRequired: true,
    providerAdmissionRequired: true,
    humanAdmissionRequired: true,
    implementationStartCondition: "Open a new capability DAG only after an explicit product ADOPT decision and all named gates are satisfied.",
    targetProduct: null,
    decidedAt: "2026-08-19T00:00:00.000Z"
  });
  assert.equal(packet.implementationEligible, false);
  assert.equal(decisionMayOpenImplementationDag(packet, [25, 47, 48]), false);
  await validateAgainstSchema(packet, "optional-capability-decision.schema.json");
});

test("SEPARATE_PRODUCT requires a different stable target product", () => {
  const packet = createOptionalCapabilityDecisionPacket({
    track: "DJ_AUDIO_ENGINE",
    decision: "SEPARATE_PRODUCT",
    rationale: "Audio DSP and hardware control are a separate product scope unless a future product decision changes that boundary.",
    evidenceAnchors: evidence,
    requiredPrerequisites: [],
    blockedByIssues: [],
    requiredFallbacks: [],
    dependencyAdmissionRequired: false,
    providerAdmissionRequired: false,
    humanAdmissionRequired: false,
    implementationStartCondition: "Create a separate product program before any DJ/audio implementation begins.",
    targetProduct: "dj-audio-product",
    decidedAt: "2026-08-19T00:00:00.000Z"
  });
  assert.equal(packet.targetProduct, "dj-audio-product");
  assert.equal(decisionMayOpenImplementationDag(packet, []), false);

  assert.throws(
    () => createOptionalCapabilityDecisionPacket({ ...packet, targetProduct: null }),
    /requires a targetProduct/
  );
  assert.throws(
    () => createOptionalCapabilityDecisionPacket({ ...packet, targetProduct: "website-design-compiler" }),
    /must differ/
  );
});

test("ADOPT is still ineligible inside the decision packet and requires explicit issue gates before a new DAG may open", () => {
  const packet = createOptionalCapabilityDecisionPacket({
    track: "MOTION_VIDEO_EXPORT",
    decision: "ADOPT",
    rationale: "Synthetic acceptance fixture for the decision contract.",
    evidenceAnchors: evidence,
    requiredPrerequisites: ["typed export contract", "rights admission"],
    blockedByIssues: [47, 48],
    requiredFallbacks: ["static poster frame"],
    dependencyAdmissionRequired: true,
    providerAdmissionRequired: false,
    humanAdmissionRequired: false,
    implementationStartCondition: "A new implementation DAG may open after issues 47 and 48 have exact verified receipts.",
    targetProduct: null,
    decidedAt: "2026-08-19T00:00:00.000Z"
  });
  assert.equal(packet.implementationEligible, false);
  assert.equal(decisionMayOpenImplementationDag(packet, [47]), false);
  assert.equal(decisionMayOpenImplementationDag(packet, [47, 48]), true);

  assert.throws(
    () => createOptionalCapabilityDecisionPacket({ ...packet, blockedByIssues: [] }),
    /must explicitly record at least one prerequisite issue gate/
  );
  assert.throws(
    () => createOptionalCapabilityDecisionPacket({ ...packet, requiredPrerequisites: [] }),
    /requires at least one entry/
  );
  assert.throws(
    () => createOptionalCapabilityDecisionPacket({ ...packet, requiredFallbacks: [] }),
    /requires at least one entry/
  );
});

test("decision identity is independent of timestamp and caller ordering but changes with semantics", () => {
  const base = {
    track: "THREE_D_PRODUCT_PHOTOSHOOT" as const,
    decision: "DEFER" as const,
    rationale: "No admitted core requirement yet.",
    evidenceAnchors: [
      { sourceIdentitySha256: h("c"), observationIdentitySha256: h("d") },
      { sourceIdentitySha256: h("a"), observationIdentitySha256: h("b") }
    ],
    requiredPrerequisites: ["technology admission", "typed patch boundary"],
    blockedByIssues: [48, 47],
    requiredFallbacks: ["semantic content", "static media"],
    dependencyAdmissionRequired: true,
    providerAdmissionRequired: true,
    humanAdmissionRequired: true,
    implementationStartCondition: "Wait for an explicit ADOPT decision.",
    targetProduct: null,
    decidedAt: "2026-08-19T00:00:00.000Z"
  };
  const first = createOptionalCapabilityDecisionPacket(base);
  const reordered = createOptionalCapabilityDecisionPacket({
    ...base,
    evidenceAnchors: [...base.evidenceAnchors].reverse(),
    requiredPrerequisites: [...base.requiredPrerequisites].reverse(),
    blockedByIssues: [...base.blockedByIssues].reverse(),
    requiredFallbacks: [...base.requiredFallbacks].reverse(),
    decidedAt: "2026-08-19T01:00:00.000Z"
  });
  const changed = createOptionalCapabilityDecisionPacket({ ...base, decision: "REJECT", blockedByIssues: [] });
  assert.equal(first.decisionIdentitySha256, reordered.decisionIdentitySha256);
  assert.notEqual(first.decisionIdentitySha256, changed.decisionIdentitySha256);
});

test("malformed evidence issue numbers and target-product leakage fail closed", () => {
  const base = {
    track: "THREE_D_PRODUCT_PHOTOSHOOT" as const,
    decision: "DEFER" as const,
    rationale: "No core requirement.",
    evidenceAnchors: evidence,
    requiredPrerequisites: [],
    blockedByIssues: [] as number[],
    requiredFallbacks: [],
    dependencyAdmissionRequired: false,
    providerAdmissionRequired: false,
    humanAdmissionRequired: false,
    implementationStartCondition: "Wait for a future decision.",
    targetProduct: null,
    decidedAt: "2026-08-19T00:00:00.000Z"
  };
  assert.throws(() => createOptionalCapabilityDecisionPacket({ ...base, evidenceAnchors: [{ sourceIdentitySha256: "bad", observationIdentitySha256: h("b") }] }), /exact SHA-256/);
  assert.throws(() => createOptionalCapabilityDecisionPacket({ ...base, blockedByIssues: [0] }), /positive GitHub issue numbers/);
  assert.throws(() => createOptionalCapabilityDecisionPacket({ ...base, targetProduct: "other-product" }), /must not assign targetProduct/);
});
