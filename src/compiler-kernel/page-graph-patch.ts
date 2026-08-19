import { createHash } from "node:crypto";
import {
  completePageGraphSignature,
  validateCompletePageGraph,
  type CompletePageGraph,
  type CompletePageNode
} from "../complete-page-graph.js";
import { pageGraphFingerprint } from "../page-graph-roundtrip.js";

export type PatchActorKind = "HUMAN" | "AGENT";
export type PageGraphPatchState = "APPLIED" | "CONFLICT" | "REJECTED";
export type PatchJsonValue = string | number | boolean | null | PatchJsonValue[] | { [key: string]: PatchJsonValue };

export interface PatchActor {
  kind: PatchActorKind;
  id: string;
}

export interface SetSectionFieldOperation {
  operationId: string;
  op: "SET_SECTION_FIELD";
  nodeId: string;
  expectedNodeKind: CompletePageNode["kind"];
  field: string;
  expectedValueSha256: string;
  value: PatchJsonValue;
  fieldProvenance: string;
}

export interface SetVariantOperation {
  operationId: string;
  op: "SET_VARIANT";
  nodeId: string;
  expectedNodeKind: CompletePageNode["kind"];
  expectedVariant: string;
  variant: string;
}

export interface MoveNodeOperation {
  operationId: string;
  op: "MOVE_NODE";
  nodeId: string;
  expectedNodeKind: CompletePageNode["kind"];
  expectedFromIndex: number;
  toIndex: number;
}

export type PageGraphPatchOperation = SetSectionFieldOperation | SetVariantOperation | MoveNodeOperation;

export interface PageGraphPatchInput {
  patchId: string;
  expectedBaseDigest: string;
  actor: PatchActor;
  evidenceSha256: readonly string[];
  operations: readonly PageGraphPatchOperation[];
}

export interface PageGraphPatch extends Omit<PageGraphPatchInput, "evidenceSha256" | "operations"> {
  schema: "website-design-compiler/page-graph-patch/v1";
  evidenceSha256: string[];
  operations: PageGraphPatchOperation[];
  patchIdentitySha256: string;
}

export interface PatchHistoryContext {
  parentReceiptSha256: string | null;
  revertsReceiptSha256: string | null;
}

export interface PageGraphPatchReceipt {
  schema: "website-design-compiler/page-graph-patch-receipt/v1";
  patchId: string;
  patchIdentitySha256: string;
  state: PageGraphPatchState;
  baseDigest: string;
  resultDigest: string | null;
  history: PatchHistoryContext;
  inverseOperations: PageGraphPatchOperation[];
  diagnostics: string[];
  receiptIdentitySha256: string;
}

export interface PageGraphPatchApplication {
  graph: CompletePageGraph | null;
  receipt: PageGraphPatchReceipt;
}

const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const CONVERSION_KINDS = new Set<CompletePageNode["kind"]>([
  "hero",
  "feature-grid",
  "proof-cloud",
  "comparison",
  "pricing",
  "product-showcase",
  "cta"
]);

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("page-graph patch cannot contain non-finite numbers");
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
  throw new Error(`page-graph patch canonical JSON does not support ${typeof value}`);
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
    throw new Error(`${field} must not contain secret assignments or machine-private paths`);
  }
  return normalized;
}

function stableId(value: string, field: string): string {
  const normalized = nonEmpty(value, field);
  if (!STABLE_ID.test(normalized)) throw new Error(`${field} must be a stable lowercase identifier`);
  return normalized;
}

function exactSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${field} must be an exact SHA-256`);
  return normalized;
}

function normalizeJsonValue(value: PatchJsonValue, field: string): PatchJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${field} cannot contain a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalizeJsonValue(entry, `${field}[${index}]`));
  if (typeof value === "object") {
    const normalized: Record<string, PatchJsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      if (!key || /[\u0000\r\n]/.test(key)) throw new Error(`${field} contains an invalid object key`);
      const entry = value[key];
      if (entry === undefined) throw new Error(`${field}.${key} cannot be undefined`);
      normalized[key] = normalizeJsonValue(entry, `${field}.${key}`);
    }
    return normalized;
  }
  throw new Error(`${field} contains an unsupported value`);
}

export function pageGraphPatchValueDigest(value: PatchJsonValue): string {
  return digest(normalizeJsonValue(value, "patch value"));
}

function normalizeActor(actor: PatchActor): PatchActor {
  if (actor.kind !== "HUMAN" && actor.kind !== "AGENT") throw new Error("patch actor kind is invalid");
  return { kind: actor.kind, id: publicSafeLine(actor.id, "actor.id") };
}

function normalizeIndex(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function normalizeOperation(operation: PageGraphPatchOperation): PageGraphPatchOperation {
  const operationId = stableId(operation.operationId, "operationId");
  const nodeId = publicSafeLine(operation.nodeId, "nodeId");
  const expectedNodeKind = operation.expectedNodeKind;
  if (operation.op === "SET_SECTION_FIELD") {
    const field = nonEmpty(operation.field, "field");
    if (!FIELD.test(field)) throw new Error("field must use governed property identifier characters");
    return {
      operationId,
      op: operation.op,
      nodeId,
      expectedNodeKind,
      field,
      expectedValueSha256: exactSha256(operation.expectedValueSha256, "expectedValueSha256"),
      value: normalizeJsonValue(operation.value, "value"),
      fieldProvenance: publicSafeLine(operation.fieldProvenance, "fieldProvenance")
    };
  }
  if (operation.op === "SET_VARIANT") {
    return {
      operationId,
      op: operation.op,
      nodeId,
      expectedNodeKind,
      expectedVariant: publicSafeLine(operation.expectedVariant, "expectedVariant"),
      variant: publicSafeLine(operation.variant, "variant")
    };
  }
  if (operation.op === "MOVE_NODE") {
    return {
      operationId,
      op: operation.op,
      nodeId,
      expectedNodeKind,
      expectedFromIndex: normalizeIndex(operation.expectedFromIndex, "expectedFromIndex"),
      toIndex: normalizeIndex(operation.toIndex, "toIndex")
    };
  }
  throw new Error("unsupported page-graph patch operation");
}

export function createPageGraphPatch(input: PageGraphPatchInput): PageGraphPatch {
  const operations = input.operations.map(normalizeOperation);
  if (operations.length === 0) throw new Error("page-graph patch requires at least one operation");
  const ids = new Set<string>();
  for (const operation of operations) {
    if (ids.has(operation.operationId)) throw new Error(`duplicate operationId: ${operation.operationId}`);
    ids.add(operation.operationId);
  }
  const evidenceSha256 = [...new Set(input.evidenceSha256.map((value) => exactSha256(value, "evidenceSha256")))].sort();
  if (evidenceSha256.length === 0) throw new Error("page-graph patch requires at least one provenance/evidence digest");
  const stable = {
    schema: "website-design-compiler/page-graph-patch/v1" as const,
    patchId: stableId(input.patchId, "patchId"),
    expectedBaseDigest: exactSha256(input.expectedBaseDigest, "expectedBaseDigest"),
    actor: normalizeActor(input.actor),
    evidenceSha256,
    operations
  };
  return { ...stable, patchIdentitySha256: digest(stable) };
}

function normalizeHistory(history: PatchHistoryContext | undefined): PatchHistoryContext {
  return {
    parentReceiptSha256: history?.parentReceiptSha256 === null || history?.parentReceiptSha256 === undefined
      ? null
      : exactSha256(history.parentReceiptSha256, "history.parentReceiptSha256"),
    revertsReceiptSha256: history?.revertsReceiptSha256 === null || history?.revertsReceiptSha256 === undefined
      ? null
      : exactSha256(history.revertsReceiptSha256, "history.revertsReceiptSha256")
  };
}

function makeReceipt(
  patch: PageGraphPatch,
  state: PageGraphPatchState,
  baseDigest: string,
  resultDigest: string | null,
  history: PatchHistoryContext,
  inverseOperations: PageGraphPatchOperation[],
  diagnostics: readonly string[]
): PageGraphPatchReceipt {
  const stable = {
    schema: "website-design-compiler/page-graph-patch-receipt/v1" as const,
    patchId: patch.patchId,
    patchIdentitySha256: patch.patchIdentitySha256,
    state,
    baseDigest: exactSha256(baseDigest, "receipt.baseDigest"),
    resultDigest: resultDigest === null ? null : exactSha256(resultDigest, "receipt.resultDigest"),
    history,
    inverseOperations: inverseOperations.map(normalizeOperation),
    diagnostics: [...new Set(diagnostics.map((entry) => publicSafeLine(entry, "diagnostic")))].sort()
  };
  return { ...stable, receiptIdentitySha256: digest(stable) };
}

function nodeAt(graph: CompletePageGraph, nodeId: string): { node: CompletePageNode; index: number } | null {
  const index = graph.nodes.findIndex((node) => node.id === nodeId);
  return index < 0 ? null : { node: graph.nodes[index]!, index };
}

function conversionPath(nodes: readonly CompletePageNode[]): string[] {
  return nodes.filter((node) => CONVERSION_KINDS.has(node.kind)).map((node) => node.id);
}

function resignAndReproject(graph: CompletePageGraph): CompletePageGraph {
  const next = structuredClone(graph);
  next.nodes.forEach((node, index) => { node.semanticIndex = index; });
  next.semanticOrder = next.nodes.map((node) => node.id);
  next.conversionPath = conversionPath(next.nodes);
  const navigation = next.nodes.find((node) => node.kind === "navigation");
  const footer = next.nodes.find((node) => node.kind === "footer");
  if (!navigation || !footer) throw new Error("patched page graph must preserve navigation and footer");
  next.sharedChrome = {
    navigationId: navigation.id,
    footerId: footer.id,
    consistencyKey: `${navigation.kind}|${footer.kind}|semantic-design-tokens/v2`
  };
  const { signature: _signature, ...unsigned } = next;
  next.signature = completePageGraphSignature(unsigned);
  return next;
}

function conflict(
  patch: PageGraphPatch,
  baseDigest: string,
  history: PatchHistoryContext,
  diagnostic: string
): PageGraphPatchApplication {
  return { graph: null, receipt: makeReceipt(patch, "CONFLICT", baseDigest, null, history, [], [diagnostic]) };
}

function rejected(
  patch: PageGraphPatch,
  baseDigest: string,
  history: PatchHistoryContext,
  diagnostics: readonly string[]
): PageGraphPatchApplication {
  return { graph: null, receipt: makeReceipt(patch, "REJECTED", baseDigest, null, history, [], diagnostics) };
}

function undoId(operationId: string): string {
  const candidate = `${operationId}.undo`;
  return candidate.length <= 128 ? candidate : `undo-${digest(operationId).slice(0, 24)}`;
}

export function applyPageGraphPatch(
  baseGraph: CompletePageGraph,
  inputPatch: PageGraphPatchInput | PageGraphPatch,
  historyInput?: PatchHistoryContext
): PageGraphPatchApplication {
  const patch = "patchIdentitySha256" in inputPatch ? createPageGraphPatch(inputPatch) : createPageGraphPatch(inputPatch);
  if ("patchIdentitySha256" in inputPatch && patch.patchIdentitySha256 !== inputPatch.patchIdentitySha256) {
    throw new Error("page-graph patch identity does not match normalized patch bytes");
  }
  const history = normalizeHistory(historyInput);
  const baseDigest = pageGraphFingerprint(baseGraph);
  if (patch.expectedBaseDigest !== baseDigest) return conflict(patch, baseDigest, history, "expected base digest does not match current page graph");

  const baseErrors = validateCompletePageGraph(baseGraph);
  if (baseErrors.length > 0) return rejected(patch, baseDigest, history, baseErrors.map((error) => `base graph invalid: ${error}`));

  let candidate = structuredClone(baseGraph);
  const inverseOperations: PageGraphPatchOperation[] = [];

  for (const operation of patch.operations) {
    const located = nodeAt(candidate, operation.nodeId);
    if (!located) return conflict(patch, baseDigest, history, `operation ${operation.operationId} targets unknown node ${operation.nodeId}`);
    if (located.node.kind !== operation.expectedNodeKind) {
      return conflict(patch, baseDigest, history, `operation ${operation.operationId} node kind precondition failed`);
    }

    if (operation.op === "SET_SECTION_FIELD") {
      if (!Object.prototype.hasOwnProperty.call(located.node.section.props, operation.field)) {
        return rejected(patch, baseDigest, history, [`operation ${operation.operationId} cannot introduce unknown section field ${operation.field}`]);
      }
      const current = located.node.section.props[operation.field] as PatchJsonValue;
      if (pageGraphPatchValueDigest(current) !== operation.expectedValueSha256) {
        return conflict(patch, baseDigest, history, `operation ${operation.operationId} field value precondition failed`);
      }
      const previousProvenance = located.node.section.provenance[operation.field];
      if (!previousProvenance) {
        return rejected(patch, baseDigest, history, [`operation ${operation.operationId} cannot edit a field without existing provenance`]);
      }
      located.node.section.props[operation.field] = structuredClone(operation.value);
      located.node.section.provenance[operation.field] = operation.fieldProvenance;
      inverseOperations.unshift({
        operationId: undoId(operation.operationId),
        op: "SET_SECTION_FIELD",
        nodeId: operation.nodeId,
        expectedNodeKind: operation.expectedNodeKind,
        field: operation.field,
        expectedValueSha256: pageGraphPatchValueDigest(operation.value),
        value: structuredClone(current),
        fieldProvenance: previousProvenance
      });
      continue;
    }

    if (operation.op === "SET_VARIANT") {
      if (located.node.variant !== operation.expectedVariant || located.node.section.variant !== operation.expectedVariant) {
        return conflict(patch, baseDigest, history, `operation ${operation.operationId} variant precondition failed`);
      }
      const previous = located.node.variant;
      located.node.variant = operation.variant;
      located.node.section.variant = operation.variant;
      inverseOperations.unshift({
        operationId: undoId(operation.operationId),
        op: "SET_VARIANT",
        nodeId: operation.nodeId,
        expectedNodeKind: operation.expectedNodeKind,
        expectedVariant: operation.variant,
        variant: previous
      });
      continue;
    }

    if (operation.op === "MOVE_NODE") {
      if (located.index !== operation.expectedFromIndex) {
        return conflict(patch, baseDigest, history, `operation ${operation.operationId} source index precondition failed`);
      }
      if (operation.toIndex >= candidate.nodes.length) {
        return rejected(patch, baseDigest, history, [`operation ${operation.operationId} target index exceeds page graph bounds`]);
      }
      const [moved] = candidate.nodes.splice(located.index, 1);
      candidate.nodes.splice(operation.toIndex, 0, moved!);
      inverseOperations.unshift({
        operationId: undoId(operation.operationId),
        op: "MOVE_NODE",
        nodeId: operation.nodeId,
        expectedNodeKind: operation.expectedNodeKind,
        expectedFromIndex: operation.toIndex,
        toIndex: located.index
      });
      continue;
    }
  }

  candidate = resignAndReproject(candidate);
  const errors = validateCompletePageGraph(candidate);
  if (errors.length > 0) {
    return rejected(patch, baseDigest, history, errors.map((error) => `patched graph invariant failed: ${error}`));
  }
  const resultDigest = pageGraphFingerprint(candidate);
  return {
    graph: candidate,
    receipt: makeReceipt(patch, "APPLIED", baseDigest, resultDigest, history, inverseOperations, [])
  };
}

export function createInversePageGraphPatch(
  receipt: PageGraphPatchReceipt,
  patchId: string,
  actor: PatchActor,
  evidenceSha256: readonly string[]
): PageGraphPatch {
  if (receipt.state !== "APPLIED" || receipt.resultDigest === null || receipt.inverseOperations.length === 0) {
    throw new Error("only an APPLIED patch receipt with inverse operations can produce an inverse patch");
  }
  return createPageGraphPatch({
    patchId,
    expectedBaseDigest: receipt.resultDigest,
    actor,
    evidenceSha256,
    operations: receipt.inverseOperations
  });
}
