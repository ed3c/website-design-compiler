import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import type { CompilerInput, CompilerReference, VisualDirectionDimensions } from "./contracts.js";
import { validateAgainstSchema } from "./validate.js";

export type { VisualDirectionDimensions } from "./contracts.js";

export interface VisualDirectionScore {
  briefFit: number;
  differentiation: number;
  readability: number;
  accessibilityRisk: number;
  implementationComplexity: number;
  performanceRisk: number;
  responsiveRobustness: number;
  originalityDistance: number | null;
  total: number;
}

export interface VisualDirectionCandidate {
  id: string;
  rank: number;
  state: "SELECTED" | "REJECTED";
  dimensions: VisualDirectionDimensions;
  score: VisualDirectionScore;
  signature: string;
  rejectionReasons: string[];
}

export interface VisualDirectionSearchReceipt {
  schema: "website-design-compiler/visual-direction-search/v2";
  project: string;
  seed: string;
  inputSha256: string;
  candidateCount: number;
  selectedCandidateId: string;
  selectedDirection: VisualDirectionDimensions;
  diversity: {
    state: "PASS";
    minimumPairwiseDistance: number;
    threshold: number;
  };
  originality: {
    state: "PASS" | "NOT_EXERCISED";
    observedReferenceCount: number;
    threshold: number;
    observations: Array<{
      receiptSha256: string;
      capturedArtifactSha256: string;
      evidenceArtifactSha256: string;
    }>;
  };
  candidates: VisualDirectionCandidate[];
}

interface ObservedVisualFingerprintReceipt {
  schema: "website-design-compiler/observed-visual-fingerprint/v3";
  state: "PASS";
  producer: "playwright-computed-style/v1";
  referenceValueSha256: string;
  capturedArtifactSha256: string;
  producerReceipt: {
    schema: "website-design-compiler/reference-browser-receipt/v2";
    path: string;
    sha256: string;
  };
  evidenceArtifacts: Array<{
    viewport: "desktop" | "mobile";
    path: string;
    sha256: string;
    width: number;
    minimumHeight: number;
  }>;
  measurements: ObservedVisualMeasurements;
  dimensions: VisualDirectionDimensions;
}

interface ReferenceBrowserReceipt {
  schema: "website-design-compiler/reference-browser-receipt/v2";
  overall: "PASS" | "FAIL";
  execution: {
    mode: "PLAYWRIGHT_BROWSER";
    startedAt: string;
    completedAt: string;
  };
  browser: { engine: "chromium"; version: string };
  capturedArtifactSha256: string;
  measurementsSha256: string;
  evidenceArtifacts: ObservedVisualFingerprintReceipt["evidenceArtifacts"];
  responsiveBehavior: { state: "PASS" | "FAIL" };
}

export interface ObservedVisualMeasurement {
  fontFamily: string;
  headingFontSizePx: number;
  bodyFontSizePx: number;
  gridColumnCount: number;
  gapPx: number;
  cardBorderWidthPx: number;
  cardBackgroundColor: string;
  bodyColor: string;
  bodyBackgroundColor: string;
  linkColor: string;
  images: number;
  videos: number;
  canvases: number;
  transitionDurationMs: number;
  transitionProperty: string;
  interactiveControlCount: number;
  revealTargetCount: number;
}

export interface ObservedVisualMeasurements {
  desktop: ObservedVisualMeasurement;
  mobile: ObservedVisualMeasurement;
}

interface VerifiedVisualReference {
  dimensions: VisualDirectionDimensions;
  receiptSha256: string;
  capturedArtifactSha256: string;
  evidenceArtifactSha256: string;
}

const DIMENSION_KEYS: Array<keyof VisualDirectionDimensions> = [
  "typography",
  "typeContrast",
  "density",
  "grid",
  "surface",
  "colorStrategy",
  "mediaStrategy",
  "motionIntensity",
  "signatureInteraction"
];

const DIVERSITY_THRESHOLD = 60;
const ORIGINALITY_THRESHOLD = 70;

const BASE_DIRECTIONS: VisualDirectionDimensions[] = [
  {
    typography: "neo-grotesk", typeContrast: "balanced", density: "balanced", grid: "modular", surface: "bordered",
    colorStrategy: "neutral-accent", mediaStrategy: "product-media", motionIntensity: "minimal", signatureInteraction: "progressive-reveal"
  },
  {
    typography: "editorial-serif", typeContrast: "dramatic", density: "airy", grid: "editorial", surface: "flat",
    colorStrategy: "warm-editorial", mediaStrategy: "editorial-media", motionIntensity: "minimal", signatureInteraction: "none"
  },
  {
    typography: "humanist-sans", typeContrast: "balanced", density: "airy", grid: "asymmetric", surface: "layered",
    colorStrategy: "tonal-brand", mediaStrategy: "interactive-stage", motionIntensity: "moderate", signatureInteraction: "spatial-focus"
  },
  {
    typography: "display-contrast", typeContrast: "dramatic", density: "dense", grid: "asymmetric", surface: "tonal",
    colorStrategy: "high-contrast", mediaStrategy: "interactive-stage", motionIntensity: "expressive", signatureInteraction: "direct-manipulation"
  },
  {
    typography: "humanist-sans", typeContrast: "restrained", density: "dense", grid: "strict", surface: "tonal",
    colorStrategy: "tonal-brand", mediaStrategy: "text-first", motionIntensity: "minimal", signatureInteraction: "direct-manipulation"
  }
];

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveWorkspacePath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error("visual evidence paths must be workspace-relative");
  const resolved = resolve(root, path);
  const traversal = relative(root, resolved);
  if (traversal.split(/[\\/]/)[0] === ".." || isAbsolute(traversal)) {
    throw new Error("visual evidence path escapes the workspace");
  }
  return resolved;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertPngEvidence(bytes: Uint8Array, expected: { width: number; minimumHeight: number; viewport: string }): void {
  const value = Buffer.from(bytes);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (value.length < 24 || !value.subarray(0, 8).equals(signature) || value.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`visual evidence for ${expected.viewport} is not a PNG browser screenshot`);
  }
  const width = value.readUInt32BE(16);
  const height = value.readUInt32BE(20);
  if (width !== expected.width || height < expected.minimumHeight) {
    throw new Error(`visual evidence PNG dimensions do not match the ${expected.viewport} browser viewport`);
  }
  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  let bitDepth = 0;
  let colorType = -1;
  const imageData: Buffer[] = [];
  while (offset + 12 <= value.length) {
    const length = value.readUInt32BE(offset);
    const type = value.toString("ascii", offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > value.length) throw new Error(`visual evidence for ${expected.viewport} has a truncated PNG chunk`);
    const dataEnd = offset + 8 + length;
    if (crc32(value.subarray(offset + 4, dataEnd)) !== value.readUInt32BE(dataEnd)) {
      throw new Error(`visual evidence for ${expected.viewport} has an invalid PNG chunk checksum`);
    }
    if (!sawHeader && type !== "IHDR") throw new Error(`visual evidence for ${expected.viewport} does not start with PNG IHDR`);
    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new Error(`visual evidence for ${expected.viewport} has an invalid PNG IHDR`);
      sawHeader = true;
      bitDepth = value[offset + 16]!;
      colorType = value[offset + 17]!;
      if (value[offset + 18] !== 0 || value[offset + 19] !== 0 || value[offset + 20] !== 0) {
        throw new Error(`visual evidence for ${expected.viewport} uses unsupported PNG encoding`);
      }
    }
    if (type === "IDAT" && length > 0) {
      sawImageData = true;
      imageData.push(value.subarray(offset + 8, dataEnd));
    }
    if (type === "IEND") {
      if (length !== 0) throw new Error(`visual evidence for ${expected.viewport} has an invalid PNG IEND`);
      sawEnd = true;
      offset = next;
      break;
    }
    offset = next;
  }
  if (!sawHeader || !sawImageData || !sawEnd || offset !== value.length) {
    throw new Error(`visual evidence for ${expected.viewport} is not a complete PNG browser screenshot`);
  }
  const channelsByColorType = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);
  const validBitDepths = new Map([[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]);
  const channels = channelsByColorType.get(colorType);
  if (!channels || !validBitDepths.get(colorType)?.includes(bitDepth) || height > 32768) {
    throw new Error(`visual evidence for ${expected.viewport} uses unsupported PNG pixel data`);
  }
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const expectedDecodedBytes = height * (rowBytes + 1);
  if (!Number.isSafeInteger(expectedDecodedBytes) || expectedDecodedBytes > 128 * 1024 * 1024) {
    throw new Error(`visual evidence for ${expected.viewport} exceeds the PNG decode budget`);
  }
  let decoded: Buffer;
  try {
    decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedDecodedBytes + 1 });
  } catch {
    throw new Error(`visual evidence for ${expected.viewport} has invalid compressed PNG pixel data`);
  }
  if (decoded.length !== expectedDecodedBytes) {
    throw new Error(`visual evidence for ${expected.viewport} has incomplete decoded PNG pixel data`);
  }
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (rowBytes + 1)]! > 4) throw new Error(`visual evidence for ${expected.viewport} has an invalid PNG row filter`);
  }
}

export function deriveObservedVisualDimensions(measurements: ObservedVisualMeasurements): VisualDirectionDimensions {
  const { desktop, mobile } = measurements;
  const family = desktop.fontFamily.toLowerCase();
  const headingRatio = desktop.bodyFontSizePx > 0 ? desktop.headingFontSizePx / desktop.bodyFontSizePx : 0;
  const responsiveGrid = desktop.gridColumnCount > 1 && mobile.gridColumnCount === 1;
  const hasAccent = desktop.linkColor !== desktop.bodyColor;
  const hasLayer = desktop.cardBackgroundColor !== "rgba(0, 0, 0, 0)" && desktop.cardBackgroundColor !== "transparent";
  const maxTransitionMs = Math.max(desktop.transitionDurationMs, mobile.transitionDurationMs);
  const interactiveControls = Math.max(desktop.interactiveControlCount, mobile.interactiveControlCount);
  const revealTargets = Math.max(desktop.revealTargetCount, mobile.revealTargetCount);
  const canvases = Math.max(desktop.canvases, mobile.canvases);
  return {
    typography: family.includes("arial") || family.includes("helvetica") || family.includes("sans-serif") ? "neo-grotesk" : family.includes("serif") ? "editorial-serif" : "humanist-sans",
    typeContrast: headingRatio >= 2 ? "dramatic" : headingRatio >= 1.4 ? "balanced" : "restrained",
    density: desktop.gapPx >= 20 ? "airy" : desktop.gapPx >= 12 ? "balanced" : "dense",
    grid: responsiveGrid ? "modular" : desktop.gridColumnCount > 1 ? "strict" : "editorial",
    surface: desktop.cardBorderWidthPx > 0 ? "bordered" : hasLayer ? "layered" : "flat",
    colorStrategy: hasAccent ? "neutral-accent" : "high-contrast",
    mediaStrategy: canvases > 0 ? "interactive-stage" : desktop.videos > 0 ? "editorial-media" : desktop.images > 0 ? "product-media" : "text-first",
    motionIntensity: maxTransitionMs >= 500 ? "expressive" : maxTransitionMs > 0 ? "moderate" : "minimal",
    signatureInteraction: revealTargets > 0 ? "progressive-reveal" : interactiveControls > 1 ? "direct-manipulation" : canvases > 0 ? "spatial-focus" : "none"
  };
}

async function referenceArtifactBytes(reference: CompilerReference, root: string): Promise<Uint8Array> {
  if (reference.kind !== "html") throw new Error("verified visual fingerprints currently require an observed HTML reference");
  if (/<(?:!doctype|html|head|body|main|section|div|article|header|footer)\b/i.test(reference.value)) {
    return new TextEncoder().encode(reference.value);
  }
  return readFile(resolveWorkspacePath(root, reference.value));
}

export async function loadVerifiedVisualReferences(input: CompilerInput, root = process.cwd()): Promise<VerifiedVisualReference[]> {
  const observations: VerifiedVisualReference[] = [];
  for (const reference of input.references ?? []) {
    if (!reference.visualEvidence) continue;
    const receiptPath = resolveWorkspacePath(root, reference.visualEvidence.receiptPath);
    const receiptBytes = await readFile(receiptPath);
    const receiptSha256 = createHash("sha256").update(receiptBytes).digest("hex");
    if (receiptSha256 !== reference.visualEvidence.receiptSha256) {
      throw new Error("visual evidence receipt bytes do not match the compiler input binding");
    }
    const receipt = JSON.parse(receiptBytes.toString("utf8")) as ObservedVisualFingerprintReceipt;
    await validateAgainstSchema(receipt, "observed-visual-fingerprint-v3.schema.json");
    if (JSON.stringify(deriveObservedVisualDimensions(receipt.measurements)) !== JSON.stringify(receipt.dimensions)) {
      throw new Error("visual evidence dimensions do not match browser measurements");
    }
    if (receipt.referenceValueSha256 !== hashText(reference.value)) {
      throw new Error("visual evidence receipt is not bound to the supplied reference value");
    }
    const capturedArtifactSha256 = createHash("sha256").update(await referenceArtifactBytes(reference, root)).digest("hex");
    if (capturedArtifactSha256 !== receipt.capturedArtifactSha256) {
      throw new Error("visual evidence captured artifact bytes do not match the receipt");
    }

    const producerReceiptBytes = await readFile(resolveWorkspacePath(root, receipt.producerReceipt.path)).catch(() => {
      throw new Error("visual evidence browser runtime receipt is absent");
    });
    const producerReceiptSha256 = createHash("sha256").update(producerReceiptBytes).digest("hex");
    if (producerReceiptSha256 !== receipt.producerReceipt.sha256) {
      throw new Error("visual evidence browser runtime receipt bytes do not match the fingerprint");
    }
    const trustedProducerReceiptSha256 = process.env.WDC_REFERENCE_BROWSER_RECEIPT_SHA256?.trim();
    if (!trustedProducerReceiptSha256 || trustedProducerReceiptSha256 !== producerReceiptSha256) {
      throw new Error("visual evidence lacks trusted browser runtime admission");
    }
    const producerReceipt = JSON.parse(producerReceiptBytes.toString("utf8")) as ReferenceBrowserReceipt;
    await validateAgainstSchema(producerReceipt, "reference-browser-receipt.schema.json");
    if (producerReceipt.schema !== receipt.producerReceipt.schema || producerReceipt.overall !== "PASS" || producerReceipt.responsiveBehavior.state !== "PASS") {
      throw new Error("visual evidence browser runtime receipt did not pass");
    }
    if (producerReceipt.capturedArtifactSha256 !== capturedArtifactSha256) {
      throw new Error("visual evidence browser runtime receipt is not bound to the captured artifact");
    }
    if (producerReceipt.measurementsSha256 !== hash(receipt.measurements)) {
      throw new Error("visual evidence measurements are not bound to the browser runtime receipt");
    }
    const viewports = receipt.evidenceArtifacts.map((evidence) => evidence.viewport).sort();
    if (JSON.stringify(viewports) !== JSON.stringify(["desktop", "mobile"])) {
      throw new Error("visual evidence must include one desktop and one mobile browser screenshot");
    }
    if (JSON.stringify(producerReceipt.evidenceArtifacts) !== JSON.stringify(receipt.evidenceArtifacts)) {
      throw new Error("visual evidence screenshots are not bound to the browser runtime receipt");
    }
    for (const evidence of receipt.evidenceArtifacts) {
      const evidenceBytes = await readFile(resolveWorkspacePath(root, evidence.path));
      const evidenceSha256 = createHash("sha256").update(evidenceBytes).digest("hex");
      if (evidenceSha256 !== evidence.sha256) {
        throw new Error(`visual evidence screenshot bytes do not match the receipt for ${evidence.viewport}`);
      }
      assertPngEvidence(evidenceBytes, evidence);
    }
    const evidenceArtifactSha256 = hash(receipt.evidenceArtifacts);
    observations.push({ dimensions: receipt.dimensions, receiptSha256, capturedArtifactSha256, evidenceArtifactSha256 });
  }
  return observations;
}

export function visualDirectionInputSha256(input: CompilerInput): string {
  return hash(input);
}

export function assertVisualDirectionSearchBinding(input: CompilerInput, receipt: VisualDirectionSearchReceipt): void {
  if (receipt.project !== input.project || receipt.inputSha256 !== visualDirectionInputSha256(input)) {
    throw new Error("visual direction search receipt is not bound to this compiler input");
  }
  const selected = receipt.candidates.find((candidate) => candidate.id === receipt.selectedCandidateId);
  if (!selected || selected.state !== "SELECTED" || JSON.stringify(selected.dimensions) !== JSON.stringify(receipt.selectedDirection)) {
    throw new Error("visual direction search receipt has an inconsistent selected candidate");
  }
}

function boundedScore(hex: string, offset: number, min: number, max: number): number {
  const byte = Number.parseInt(hex.slice(offset, offset + 2), 16);
  return min + (byte % (max - min + 1));
}

function pageFitBonus(pageType: string, direction: VisualDirectionDimensions): number {
  const value = pageType.toLowerCase();
  if (value.includes("editorial") && direction.grid === "editorial") return 20;
  if ((value.includes("motion") || value.includes("creative")) && direction.motionIntensity === "expressive") return 20;
  if ((value.includes("3d") || value.includes("2d")) && direction.mediaStrategy === "interactive-stage") return 18;
  if (value.includes("b2b") && direction.grid === "strict" && direction.mediaStrategy === "text-first") return 24;
  if ((value.includes("product") || value.includes("b2b")) && direction.typography === "neo-grotesk") return 18;
  if ((value.includes("premium") || value.includes("consumer")) && direction.density === "airy" && direction.surface !== "bordered") return 18;
  return 2;
}

function riskFor(direction: VisualDirectionDimensions): { accessibility: number; complexity: number; performance: number; responsive: number } {
  const expressive = direction.motionIntensity === "expressive" ? 14 : direction.motionIntensity === "moderate" ? 7 : 2;
  const interactive = direction.mediaStrategy === "interactive-stage" ? 13 : direction.mediaStrategy === "product-media" ? 5 : 2;
  const dense = direction.density === "dense" ? 10 : direction.density === "balanced" ? 4 : 2;
  return {
    accessibility: Math.min(25, expressive + dense),
    complexity: Math.min(25, interactive + expressive),
    performance: Math.min(25, interactive + expressive),
    responsive: Math.max(55, 94 - dense - (direction.grid === "asymmetric" ? 8 : 2))
  };
}

function scoreCandidate(
  input: CompilerInput,
  direction: VisualDirectionDimensions,
  seedHash: string,
  candidateIndex: number,
  differentiation: number,
  originalityDistance: number | null
): VisualDirectionScore {
  const risk = riskFor(direction);
  const offset = candidateIndex * 4;
  const categoryFit = pageFitBonus(input.brief.pageType, direction);
  const briefFit = Math.min(100, boundedScore(seedHash, offset, 72, 88) + categoryFit);
  const readability = direction.typeContrast === "dramatic" && direction.density === "dense" ? 72 : boundedScore(seedHash, offset + 2, 82, 97);
  const positiveWeight = 0.77 + (originalityDistance === null ? 0 : 0.15);
  const positiveScore = (
    briefFit * 0.27 + differentiation * 0.18 + readability * 0.18 + risk.responsive * 0.14 + (originalityDistance ?? 0) * 0.15
  ) / positiveWeight;
  const total = Math.round(positiveScore + categoryFit * 0.5 - risk.accessibility * 0.03 - risk.complexity * 0.025 - risk.performance * 0.025);
  return {
    briefFit,
    differentiation,
    readability,
    accessibilityRisk: risk.accessibility,
    implementationComplexity: risk.complexity,
    performanceRisk: risk.performance,
    responsiveRobustness: risk.responsive,
    originalityDistance,
    total
  };
}

export function visualDirectionDistance(first: VisualDirectionDimensions, second: VisualDirectionDimensions): number {
  const differentDimensions = DIMENSION_KEYS.filter((key) => first[key] !== second[key]).length;
  return Math.round((differentDimensions / DIMENSION_KEYS.length) * 100);
}

function minimumDistance(direction: VisualDirectionDimensions, references: readonly VisualDirectionDimensions[]): number | null {
  if (references.length === 0) return null;
  return Math.min(...references.map((reference) => visualDirectionDistance(direction, reference)));
}

export function auditCandidateOriginality(
  candidate: Pick<VisualDirectionCandidate, "dimensions">,
  observedReferences: readonly VisualDirectionDimensions[]
): string[] {
  const distance = minimumDistance(candidate.dimensions, observedReferences);
  return distance !== null && distance < ORIGINALITY_THRESHOLD
    ? [`candidate is too close to an observed reference (${distance} < ${ORIGINALITY_THRESHOLD})`]
    : [];
}

function preferredDirectionIndex(pageType: string): number | null {
  const value = pageType.toLowerCase();
  if (value.includes("b2b")) return 4;
  if (value.includes("editorial")) return 1;
  if (value.includes("motion") || value.includes("creative")) return 3;
  if (value.includes("3d") || value.includes("2d")) return 2;
  if (value.includes("premium") || value.includes("consumer")) return 1;
  if (value.includes("product")) return 0;
  return null;
}

function rotateDirections(seedHash: string, pageType: string): VisualDirectionDimensions[] {
  const seededStart = Number.parseInt(seedHash.slice(0, 2), 16) % BASE_DIRECTIONS.length;
  const preferred = preferredDirectionIndex(pageType);
  const indices = preferred === null ? [] : [preferred];
  for (let offset = 0; indices.length < 3 && offset < BASE_DIRECTIONS.length; offset += 1) {
    const index = (seededStart + offset) % BASE_DIRECTIONS.length;
    if (!indices.includes(index)) indices.push(index);
  }
  return indices.map((index) => ({ ...BASE_DIRECTIONS[index]! }));
}

export function searchVisualDirections(
  input: CompilerInput,
  seed = "website-design-compiler/v2",
  verifiedReferences: readonly VerifiedVisualReference[] = []
): VisualDirectionSearchReceipt {
  const inputSha256 = visualDirectionInputSha256(input);
  const seedHash = hash({ seed, inputSha256, project: input.project });
  const observedReferences = verifiedReferences.map((reference) => reference.dimensions);
  const directions = rotateDirections(seedHash, input.brief.pageType);
  const pairwiseDistances = directions.flatMap((direction, index) =>
    directions.slice(index + 1).map((other) => visualDirectionDistance(direction, other))
  );
  const minimumPairwiseDistance = Math.min(...pairwiseDistances);
  if (minimumPairwiseDistance < DIVERSITY_THRESHOLD) {
    throw new Error(`visual direction diversity is below threshold (${minimumPairwiseDistance} < ${DIVERSITY_THRESHOLD})`);
  }
  const initial = directions.map((dimensions, index) => {
    const differentiation = Math.min(...directions.filter((_, otherIndex) => otherIndex !== index).map((other) => visualDirectionDistance(dimensions, other)));
    const originalityDistance = minimumDistance(dimensions, observedReferences);
    const score = scoreCandidate(input, dimensions, seedHash, index, differentiation, originalityDistance);
    const signature = hash(dimensions);
    const rejectionReasons = auditCandidateOriginality({ dimensions }, observedReferences);
    return { id: `direction-${index + 1}`, dimensions, score, signature, rejectionReasons };
  });

  const admissible = initial.filter((candidate) => candidate.rejectionReasons.length === 0).sort((a, b) => b.score.total - a.score.total || a.id.localeCompare(b.id));
  if (admissible.length === 0) throw new Error("visual direction search produced no originality-admissible candidate");
  const selectedId = admissible[0]!.id;
  const ranked = [...initial]
    .sort((a, b) => {
      if (a.id === selectedId) return -1;
      if (b.id === selectedId) return 1;
      return b.score.total - a.score.total || a.id.localeCompare(b.id);
    })
    .map<VisualDirectionCandidate>((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      state: candidate.id === selectedId ? "SELECTED" : "REJECTED",
      rejectionReasons: candidate.id === selectedId ? [] : candidate.rejectionReasons.length > 0 ? candidate.rejectionReasons : [`lower ranked score than ${selectedId}`]
    }));
  const selected = ranked.find((candidate) => candidate.id === selectedId)!;

  return {
    schema: "website-design-compiler/visual-direction-search/v2",
    project: input.project,
    seed,
    inputSha256,
    candidateCount: ranked.length,
    selectedCandidateId: selectedId,
    selectedDirection: { ...selected.dimensions },
    diversity: {
      state: "PASS",
      minimumPairwiseDistance,
      threshold: DIVERSITY_THRESHOLD
    },
    originality: {
      state: observedReferences.length > 0 ? "PASS" : "NOT_EXERCISED",
      observedReferenceCount: observedReferences.length,
      threshold: ORIGINALITY_THRESHOLD,
      observations: verifiedReferences.map((reference) => ({
        receiptSha256: reference.receiptSha256,
        capturedArtifactSha256: reference.capturedArtifactSha256,
        evidenceArtifactSha256: reference.evidenceArtifactSha256
      }))
    },
    candidates: ranked
  };
}

export async function writeVisualDirectionSearch(
  input: CompilerInput,
  outputDirectory: string,
  receipt = searchVisualDirections(input)
): Promise<string> {
  assertVisualDirectionSearchBinding(input, receipt);
  await validateAgainstSchema(receipt, "visual-direction-search-v2.schema.json");
  const directory = join(outputDirectory, "visual-direction-search");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "visual-direction-search.json");
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return path;
}
