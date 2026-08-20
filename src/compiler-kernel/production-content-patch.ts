import { createHash } from "node:crypto";
import {
  completePageGraphSignature,
  validateCompletePageGraph,
  type CompletePageGraph,
  type CompletePageNode
} from "../complete-page-graph.js";
import {
  maxCharactersForContentSlot,
  qualityForContentFields,
  validContentValue,
  validateSectionContentContract,
  type ContentFieldContract,
  type ContentSourceType,
  type ContentValue,
  type SectionContentContract
} from "../content-contract.js";
import { FIELD_SLOTS, SECTION_TYPE_TO_KIND, sectionFieldNameForContentSlot } from "../section-content-projection.js";
import { SECTION_CONTRACTS } from "../section-grammar.js";
import { assertLosslessPageGraphRoundTrip, pageGraphFingerprint } from "../page-graph-roundtrip.js";
import {
  evaluatePageGraphConstraints,
  introducedHardConstraintFailures,
  type PageGraphConstraintReport
} from "./constraint-model.js";
import type { PatchActor } from "./page-graph-patch.js";

export type AdmittedContentSourceType = Extract<ContentSourceType, "observed_fact" | "user_supplied_claim">;
export type ProductionContentPatchState = "APPLIED" | "CONFLICT" | "REJECTED" | "HARD_CONSTRAINT_REJECTED";
export type ProductionContentPatchMode = "FORWARD" | "REVERT";

export interface SetProductionContentSlotOperation {
  operationId: string;
  op: "SET_CONTENT_SLOT";
  nodeId: string;
  expectedNodeKind: CompletePageNode["kind"];
  field: string;
  slot: string;
  expectedContentFieldSha256: string;
  value: ContentValue;
  sourceType: AdmittedContentSourceType;
  sourceObservationSha256: string;
}

export interface ProductionContentPatchInput {
  patchId: string;
  expectedBaseDigest: string;
  actor: PatchActor;
  evidenceSha256: readonly string[];
  operations: readonly SetProductionContentSlotOperation[];
}

export interface ProductionContentPatch extends Omit<ProductionContentPatchInput, "evidenceSha256" | "operations"> {
  schema: "website-design-compiler/production-content-patch/v1";
  evidenceSha256: string[];
  operations: SetProductionContentSlotOperation[];
  patchIdentitySha256: string;
}

export interface ProductionContentOperationRef {
  operationId: string;
  nodeId: string;
  field: string;
  slot: string;
  beforeContentFieldSha256: string;
  afterContentFieldSha256: string;
}

export interface ProductionContentPatchHistory {
  parentReceiptSha256: string | null;
  revertsReceiptSha256: string | null;
}

export interface ProductionContentPatchReceipt {
  schema: "website-design-compiler/production-content-patch-receipt/v1";
  mode: ProductionContentPatchMode;
  patchId: string;
  patchIdentitySha256: string;
  state: ProductionContentPatchState;
  baseDigest: string;
  resultDigest: string | null;
  history: ProductionContentPatchHistory;
  operationRefs: ProductionContentOperationRef[];
  beforeConstraintReportIdentitySha256: string;
  afterConstraintReportIdentitySha256: string | null;
  introducedHardFailures: string[];
  diagnostics: string[];
  receiptIdentitySha256: string;
}

export interface ProductionContentPatchApplication {
  graph: CompletePageGraph | null;
  beforeConstraints: PageGraphConstraintReport;
  afterConstraints: PageGraphConstraintReport | null;
  receipt: ProductionContentPatchReceipt;
}

const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const SOURCE_OBSERVATION_PREFIX = "source-observation:sha256:";

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("production content patch cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error(`production content patch canonical JSON does not support ${typeof value}`);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be non-empty`);
  return normalized;
}

function publicSafeLine(value: string, field: string): string {
  const normalized = nonEmpty(value, field);
  if (/[\u0000\r\n]/.test(normalized)) throw new Error(`${field} must be one public-safe line`);
  if (/(?:password|token|secret|credential)\s*=/i.test(normalized) || /\/(?:Users|home)\//.test(normalized)) {
    throw new Error(`${field} must not contain secret assignments or private machine paths`);
  }
  return normalized;
}

function stableId(value: string, field: string): string {
  const normalized = publicSafeLine(value, field);
  if (!STABLE_ID.test(normalized)) throw new Error(`${field} must be a stable lowercase identifier`);
  return normalized;
}

function exactSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function normalizeActor(actor: PatchActor): PatchActor {
  if (actor.kind !== "HUMAN" && actor.kind !== "AGENT") throw new Error("patch actor kind is invalid");
  return { kind: actor.kind, id: publicSafeLine(actor.id, "actor.id") };
}

function normalizeContentValue(value: ContentValue): ContentValue {
  if (typeof value === "string") return publicSafeLine(value, "operation.value");
  if (!Array.isArray(value) || value.length === 0) throw new Error("operation.value list must be non-empty");
  return value.map((entry) => publicSafeLine(entry, "operation.value[]"));
}

export function productionContentFieldDigest(field: ContentFieldContract): string {
  return digest(field);
}

function normalizeOperation(operation: SetProductionContentSlotOperation): SetProductionContentSlotOperation {
  if (operation.op !== "SET_CONTENT_SLOT") throw new Error("unsupported production content patch operation");
  const field = publicSafeLine(operation.field, "operation.field");
  if (!FIELD.test(field)) throw new Error("operation.field must use governed property identifier characters");
  if (operation.sourceType !== "observed_fact" && operation.sourceType !== "user_supplied_claim") {
    throw new Error("publishable production content edits require observed_fact or user_supplied_claim sourceType");
  }
  return {
    operationId: stableId(operation.operationId, "operationId"),
    op: "SET_CONTENT_SLOT",
    nodeId: publicSafeLine(operation.nodeId, "operation.nodeId"),
    expectedNodeKind: operation.expectedNodeKind,
    field,
    slot: stableId(operation.slot, "operation.slot"),
    expectedContentFieldSha256: exactSha256(operation.expectedContentFieldSha256, "expectedContentFieldSha256"),
    value: normalizeContentValue(operation.value),
    sourceType: operation.sourceType,
    sourceObservationSha256: exactSha256(operation.sourceObservationSha256, "sourceObservationSha256")
  };
}

export function createProductionContentPatch(input: ProductionContentPatchInput): ProductionContentPatch {
  const operations = input.operations.map(normalizeOperation);
  if (operations.length === 0) throw new Error("production content patch requires at least one operation");
  const operationIds = new Set<string>();
  for (const operation of operations) {
    if (operationIds.has(operation.operationId)) throw new Error(`duplicate operationId: ${operation.operationId}`);
    operationIds.add(operation.operationId);
  }
  const evidenceSha256 = [...new Set(input.evidenceSha256.map((entry) => exactSha256(entry, "evidenceSha256")))].sort();
  if (evidenceSha256.length === 0) throw new Error("production content patch requires at least one evidence identity");
  for (const operation of operations) {
    if (!evidenceSha256.includes(operation.sourceObservationSha256)) {
      throw new Error(`operation ${operation.operationId} source observation is not present in the patch evidence set`);
    }
  }
  const stable = {
    schema: "website-design-compiler/production-content-patch/v1" as const,
    patchId: stableId(input.patchId, "patchId"),
    expectedBaseDigest: exactSha256(input.expectedBaseDigest, "expectedBaseDigest"),
    actor: normalizeActor(input.actor),
    evidenceSha256,
    operations
  };
  return { ...stable, patchIdentitySha256: digest(stable) };
}

function findContentField(contract: SectionContentContract, slot: string): ContentFieldContract | null {
  return contract.fields.find((field) => field.slot === slot) ?? null;
}

function sourceFieldsForSectionField(node: CompletePageNode, field: string): ContentFieldContract[] {
  const contract = node.contentContract;
  if (!contract) return [];
  const slots = FIELD_SLOTS[node.kind]?.[field] ?? [];
  return slots.flatMap((slot) => {
    const candidate = contract.fields.find((entry) => entry.slot === slot);
    return candidate ? [candidate] : [];
  });
}

function existingLinkHref(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const href = (value as Record<string, unknown>).href;
  return typeof href === "string" && href.length > 0 ? href : null;
}

function projectSectionField(node: CompletePageNode, field: string): { value: unknown; provenance: string } {
  const fieldContract = SECTION_CONTRACTS[node.kind].fields[field];
  if (!fieldContract) throw new Error(`${node.id}.${field}: unknown governed section field`);
  const sources = sourceFieldsForSectionField(node, field);
  if (fieldContract.type === "media") {
    const asset = sources.find((entry) => entry.slot.endsWith("asset-id"));
    const alt = sources.find((entry) => entry.slot.endsWith("-alt"));
    if (asset?.state !== "READY" || !asset.publishable || typeof asset.value !== "string" || asset.provenance.length === 0) {
      throw new Error(`${node.id}.${field}: media asset content backing is incomplete`);
    }
    if (alt?.state !== "READY" || !alt.publishable || typeof alt.value !== "string" || alt.provenance.length === 0) {
      throw new Error(`${node.id}.${field}: media alt content backing is incomplete`);
    }
    return {
      value: { assetId: asset.value, alt: alt.value },
      provenance: [asset, alt].map((entry) => entry.provenance.join("|")).join("|")
    };
  }
  if (sources.length !== 1) {
    throw new Error(`${node.id}.${field}: content backing is absent or ambiguous for this section type`);
  }
  const source = sources[0]!;
  if (source.state !== "READY" || !source.publishable || source.value === null || source.provenance.length === 0) {
    throw new Error(`${node.id}.${field}: content backing is not READY/publishable`);
  }
  if (fieldContract.type === "items") {
    if (!Array.isArray(source.value)) throw new Error(`${node.id}.${field}: list field requires list content backing`);
    return { value: structuredClone(source.value), provenance: source.provenance.join("|") };
  }
  if (fieldContract.type === "link") {
    if (typeof source.value !== "string") throw new Error(`${node.id}.${field}: link label requires scalar content backing`);
    const href = existingLinkHref(node.section.props[field]);
    if (!href) throw new Error(`${node.id}.${field}: existing governed link target is absent`);
    return { value: { label: source.value, href }, provenance: source.provenance.join("|") };
  }
  if (fieldContract.type === "number") {
    if (typeof source.value !== "string") throw new Error(`${node.id}.${field}: number field requires scalar content backing`);
    const value = Number(source.value);
    if (!Number.isFinite(value)) throw new Error(`${node.id}.${field}: number content backing is not finite`);
    return { value, provenance: source.provenance.join("|") };
  }
  if (typeof source.value !== "string") throw new Error(`${node.id}.${field}: scalar field requires scalar content backing`);
  return { value: source.value, provenance: source.provenance.join("|") };
}

function requiredEvidenceMissing(node: CompletePageNode): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(node.section.props)) if (!node.section.provenance[key]) missing.push(`${node.id}.${key}`);
  for (const [key, field] of Object.entries(SECTION_CONTRACTS[node.kind].fields)) {
    const value = node.section.props[key];
    if (field.required && (value === undefined || value === null || value === "")) missing.push(`${node.id}.${key}`);
  }
  return missing;
}

function contentEvidenceMissing(node: CompletePageNode): string[] {
  const contract = node.contentContract;
  if (!contract) return [];
  const fields = contract.fields
    .filter((field) => field.state !== "READY" || !field.publishable || !field.value || field.provenance.length === 0)
    .map((field) => `${node.id}.content.${field.slot}`);
  if (contract.quality.forbiddenPhraseHits.length > 0 || contract.quality.repeatedPublishableValues.length > 0) {
    fields.push(`${node.id}.content.quality`);
  }
  return fields;
}

function reprojectGraph(candidate: CompletePageGraph): CompletePageGraph {
  const next = structuredClone(candidate);
  const missingEvidence = [...new Set([
    ...next.sourceMissingEvidence,
    ...next.nodes.flatMap((node) => [...requiredEvidenceMissing(node), ...contentEvidenceMissing(node)])
  ])].sort();
  next.missingEvidence = missingEvidence;
  next.readiness = missingEvidence.length === 0 ? "READY" : "NEEDS_INPUT";
  const { signature: _signature, ...unsigned } = next;
  next.signature = completePageGraphSignature(unsigned);
  return next;
}

function receipt(
  mode: ProductionContentPatchMode,
  patchId: string,
  patchIdentitySha256: string,
  state: ProductionContentPatchState,
  baseDigest: string,
  resultDigest: string | null,
  history: ProductionContentPatchHistory,
  operationRefs: readonly ProductionContentOperationRef[],
  beforeConstraints: PageGraphConstraintReport,
  afterConstraints: PageGraphConstraintReport | null,
  introducedHardFailures: readonly string[],
  diagnostics: readonly string[]
): ProductionContentPatchReceipt {
  const stable = {
    schema: "website-design-compiler/production-content-patch-receipt/v1" as const,
    mode,
    patchId: stableId(patchId, "receipt.patchId"),
    patchIdentitySha256: exactSha256(patchIdentitySha256, "receipt.patchIdentitySha256"),
    state,
    baseDigest: exactSha256(baseDigest, "receipt.baseDigest"),
    resultDigest: resultDigest === null ? null : exactSha256(resultDigest, "receipt.resultDigest"),
    history,
    operationRefs: [...operationRefs],
    beforeConstraintReportIdentitySha256: beforeConstraints.reportIdentitySha256,
    afterConstraintReportIdentitySha256: afterConstraints?.reportIdentitySha256 ?? null,
    introducedHardFailures: [...new Set(introducedHardFailures)].sort(),
    diagnostics: [...new Set(diagnostics.map((entry) => publicSafeLine(entry, "diagnostic")))].sort()
  };
  return { ...stable, receiptIdentitySha256: digest(stable) };
}

function rejectedApplication(
  patch: ProductionContentPatch,
  baseGraph: CompletePageGraph,
  beforeConstraints: PageGraphConstraintReport,
  state: "CONFLICT" | "REJECTED",
  diagnostics: readonly string[]
): ProductionContentPatchApplication {
  const baseDigest = pageGraphFingerprint(baseGraph);
  return {
    graph: null,
    beforeConstraints,
    afterConstraints: null,
    receipt: receipt(
      "FORWARD",
      patch.patchId,
      patch.patchIdentitySha256,
      state,
      baseDigest,
      null,
      { parentReceiptSha256: null, revertsReceiptSha256: null },
      [],
      beforeConstraints,
      null,
      [],
      diagnostics
    )
  };
}

export function applyProductionContentPatch(
  baseGraph: CompletePageGraph,
  inputPatch: ProductionContentPatchInput | ProductionContentPatch
): ProductionContentPatchApplication {
  const patch = createProductionContentPatch(inputPatch);
  if ("patchIdentitySha256" in inputPatch && patch.patchIdentitySha256 !== inputPatch.patchIdentitySha256) {
    throw new Error("production content patch identity does not match normalized patch bytes");
  }
  const beforeConstraints = evaluatePageGraphConstraints(baseGraph);
  const baseDigest = pageGraphFingerprint(baseGraph);
  if (baseGraph.source.mode !== "PRODUCTION") {
    return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", ["production content patch requires a PRODUCTION page graph"]);
  }
  if (patch.expectedBaseDigest !== baseDigest) {
    return rejectedApplication(patch, baseGraph, beforeConstraints, "CONFLICT", ["expected base digest does not match current production page graph"]);
  }
  const baseErrors = validateCompletePageGraph(baseGraph);
  if (baseErrors.length > 0) {
    return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", baseErrors.map((entry) => `base graph invalid: ${entry}`));
  }

  let candidate = structuredClone(baseGraph);
  const refs: ProductionContentOperationRef[] = [];
  for (const operation of patch.operations) {
    const node = candidate.nodes.find((entry) => entry.id === operation.nodeId);
    if (!node) return rejectedApplication(patch, baseGraph, beforeConstraints, "CONFLICT", [`operation ${operation.operationId} targets unknown node ${operation.nodeId}`]);
    if (node.kind !== operation.expectedNodeKind) {
      return rejectedApplication(patch, baseGraph, beforeConstraints, "CONFLICT", [`operation ${operation.operationId} node kind precondition failed`]);
    }
    const contract = node.contentContract;
    if (!contract) return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", [`operation ${operation.operationId} production node lacks content contract`]);
    if (contract.sectionId !== node.id || SECTION_TYPE_TO_KIND[contract.sectionType] !== node.kind) {
      return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", [`operation ${operation.operationId} section/content contract identity drift`]);
    }
    const mappedField = sectionFieldNameForContentSlot(contract.sectionType, operation.slot);
    if (mappedField !== operation.field || !(FIELD_SLOTS[node.kind]?.[operation.field] ?? []).includes(operation.slot)) {
      return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", [`operation ${operation.operationId} section field/content slot mismatch`]);
    }
    const contentField = findContentField(contract, operation.slot);
    if (!contentField) return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", [`operation ${operation.operationId} content slot is absent from the embedded contract`]);
    const beforeFieldSha256 = productionContentFieldDigest(contentField);
    if (beforeFieldSha256 !== operation.expectedContentFieldSha256) {
      return rejectedApplication(patch, baseGraph, beforeConstraints, "CONFLICT", [`operation ${operation.operationId} content-field precondition failed`]);
    }
    const maxCharacters = maxCharactersForContentSlot(operation.slot, contract.sectionType);
    if (!validContentValue(operation.slot, operation.value, maxCharacters)) {
      return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", [`operation ${operation.operationId} content value does not satisfy scalar/list or length contract`]);
    }
    if (SECTION_CONTRACTS[node.kind].claimPolicy === "EVIDENCE_REQUIRED" && operation.sourceType !== "observed_fact") {
      return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", [`operation ${operation.operationId} claim-sensitive section requires observed_fact evidence`]);
    }
    const provenance = `${SOURCE_OBSERVATION_PREFIX}${operation.sourceObservationSha256}`;
    if (!patch.evidenceSha256.includes(operation.sourceObservationSha256)) {
      return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", [`operation ${operation.operationId} source observation is not admitted by this patch`]);
    }

    contentField.state = "READY";
    contentField.sourceType = operation.sourceType;
    contentField.value = structuredClone(operation.value);
    contentField.publishable = true;
    contentField.provenance = [provenance];
    contract.quality = qualityForContentFields(contract.fields);
    const contractErrors = validateSectionContentContract(contract);
    if (contractErrors.length > 0) {
      return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", contractErrors.map((entry) => `operation ${operation.operationId} content contract invalid: ${entry}`));
    }
    let projected: { value: unknown; provenance: string };
    try {
      projected = projectSectionField(node, operation.field);
    } catch (error) {
      return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", [error instanceof Error ? error.message : `operation ${operation.operationId} projection failed`]);
    }
    node.section.props[operation.field] = structuredClone(projected.value);
    node.section.provenance[operation.field] = projected.provenance;
    refs.push({
      operationId: operation.operationId,
      nodeId: operation.nodeId,
      field: operation.field,
      slot: operation.slot,
      beforeContentFieldSha256: beforeFieldSha256,
      afterContentFieldSha256: productionContentFieldDigest(contentField)
    });
  }

  candidate = reprojectGraph(candidate);
  const candidateErrors = validateCompletePageGraph(candidate);
  if (candidateErrors.length > 0) {
    return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", candidateErrors.map((entry) => `patched production graph invalid: ${entry}`));
  }
  try {
    assertLosslessPageGraphRoundTrip(candidate);
  } catch (error) {
    return rejectedApplication(patch, baseGraph, beforeConstraints, "REJECTED", [error instanceof Error ? error.message : "Puck/Payload round-trip failed"]);
  }
  const afterConstraints = evaluatePageGraphConstraints(candidate);
  const introducedHardFailures = introducedHardConstraintFailures(beforeConstraints, afterConstraints);
  if (introducedHardFailures.length > 0) {
    return {
      graph: null,
      beforeConstraints,
      afterConstraints,
      receipt: receipt(
        "FORWARD",
        patch.patchId,
        patch.patchIdentitySha256,
        "HARD_CONSTRAINT_REJECTED",
        baseDigest,
        null,
        { parentReceiptSha256: null, revertsReceiptSha256: null },
        refs,
        beforeConstraints,
        afterConstraints,
        introducedHardFailures,
        introducedHardFailures.map((entry) => `new hard constraint failure: ${entry}`)
      )
    };
  }
  const resultDigest = pageGraphFingerprint(candidate);
  return {
    graph: candidate,
    beforeConstraints,
    afterConstraints,
    receipt: receipt(
      "FORWARD",
      patch.patchId,
      patch.patchIdentitySha256,
      "APPLIED",
      baseDigest,
      resultDigest,
      { parentReceiptSha256: null, revertsReceiptSha256: null },
      refs,
      beforeConstraints,
      afterConstraints,
      [],
      []
    )
  };
}

export function revertProductionContentPatch(
  currentGraph: CompletePageGraph,
  priorGraph: CompletePageGraph,
  appliedReceipt: ProductionContentPatchReceipt,
  patchId: string,
  actor: PatchActor
): ProductionContentPatchApplication {
  const beforeConstraints = evaluatePageGraphConstraints(currentGraph);
  const currentDigest = pageGraphFingerprint(currentGraph);
  const priorDigest = pageGraphFingerprint(priorGraph);
  const revertIdentity = digest({
    schema: "website-design-compiler/production-content-revert/v1",
    patchId: stableId(patchId, "patchId"),
    actor: normalizeActor(actor),
    parentReceiptSha256: appliedReceipt.receiptIdentitySha256,
    currentDigest,
    priorDigest
  });
  const history = {
    parentReceiptSha256: appliedReceipt.receiptIdentitySha256,
    revertsReceiptSha256: appliedReceipt.receiptIdentitySha256
  };
  if (appliedReceipt.mode !== "FORWARD" || appliedReceipt.state !== "APPLIED" || appliedReceipt.resultDigest === null) {
    return {
      graph: null,
      beforeConstraints,
      afterConstraints: null,
      receipt: receipt("REVERT", patchId, revertIdentity, "REJECTED", currentDigest, null, history, [], beforeConstraints, null, [], ["only an APPLIED forward receipt can be reverted"])
    };
  }
  if (currentDigest !== appliedReceipt.resultDigest || priorDigest !== appliedReceipt.baseDigest) {
    return {
      graph: null,
      beforeConstraints,
      afterConstraints: null,
      receipt: receipt("REVERT", patchId, revertIdentity, "CONFLICT", currentDigest, null, history, [], beforeConstraints, null, [], ["revert graph identities do not match the applied receipt"])
    };
  }
  if (currentGraph.source.mode !== "PRODUCTION" || priorGraph.source.mode !== "PRODUCTION") {
    return {
      graph: null,
      beforeConstraints,
      afterConstraints: null,
      receipt: receipt("REVERT", patchId, revertIdentity, "REJECTED", currentDigest, null, history, [], beforeConstraints, null, [], ["revert requires production page graphs"])
    };
  }

  const candidate = structuredClone(currentGraph);
  for (const ref of appliedReceipt.operationRefs) {
    const currentNode = candidate.nodes.find((node) => node.id === ref.nodeId);
    const priorNode = priorGraph.nodes.find((node) => node.id === ref.nodeId);
    if (!currentNode?.contentContract || !priorNode?.contentContract) {
      return {
        graph: null,
        beforeConstraints,
        afterConstraints: null,
        receipt: receipt("REVERT", patchId, revertIdentity, "CONFLICT", currentDigest, null, history, [], beforeConstraints, null, [], [`revert node ${ref.nodeId} content contract is absent`])
      };
    }
    const currentField = findContentField(currentNode.contentContract, ref.slot);
    const priorField = findContentField(priorNode.contentContract, ref.slot);
    if (!currentField || !priorField || productionContentFieldDigest(currentField) !== ref.afterContentFieldSha256 || productionContentFieldDigest(priorField) !== ref.beforeContentFieldSha256) {
      return {
        graph: null,
        beforeConstraints,
        afterConstraints: null,
        receipt: receipt("REVERT", patchId, revertIdentity, "CONFLICT", currentDigest, null, history, [], beforeConstraints, null, [], [`revert content-field identity drift for ${ref.nodeId}.${ref.slot}`])
      };
    }
    currentNode.section = structuredClone(priorNode.section);
    currentNode.contentContract = structuredClone(priorNode.contentContract);
  }
  const restored = reprojectGraph(candidate);
  const errors = validateCompletePageGraph(restored);
  if (errors.length > 0 || pageGraphFingerprint(restored) !== priorDigest) {
    return {
      graph: null,
      beforeConstraints,
      afterConstraints: null,
      receipt: receipt("REVERT", patchId, revertIdentity, "REJECTED", currentDigest, null, history, [], beforeConstraints, null, [], [...errors.map((entry) => `restored graph invalid: ${entry}`), ...(pageGraphFingerprint(restored) !== priorDigest ? ["restored graph digest does not equal prior graph"] : [])])
    };
  }
  assertLosslessPageGraphRoundTrip(restored);
  const afterConstraints = evaluatePageGraphConstraints(restored);
  const resultDigest = pageGraphFingerprint(restored);
  const reverseRefs = appliedReceipt.operationRefs.map((ref) => ({
    ...ref,
    beforeContentFieldSha256: ref.afterContentFieldSha256,
    afterContentFieldSha256: ref.beforeContentFieldSha256
  }));
  return {
    graph: restored,
    beforeConstraints,
    afterConstraints,
    receipt: receipt("REVERT", patchId, revertIdentity, "APPLIED", currentDigest, resultDigest, history, reverseRefs, beforeConstraints, afterConstraints, [], [])
  };
}
