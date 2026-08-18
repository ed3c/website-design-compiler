import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
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
  schema: "website-design-compiler/observed-visual-fingerprint/v2";
  state: "PASS";
  producer: "playwright-computed-style/v1";
  referenceValueSha256: string;
  capturedArtifactSha256: string;
  evidenceArtifact: { path: string; sha256: string };
  measurements: ObservedVisualMeasurements;
  dimensions: VisualDirectionDimensions;
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
    await validateAgainstSchema(receipt, "observed-visual-fingerprint-v2.schema.json");
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
    const evidenceBytes = await readFile(resolveWorkspacePath(root, receipt.evidenceArtifact.path));
    const evidenceArtifactSha256 = createHash("sha256").update(evidenceBytes).digest("hex");
    if (evidenceArtifactSha256 !== receipt.evidenceArtifact.sha256) {
      throw new Error("visual evidence screenshot bytes do not match the receipt");
    }
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
  const briefFit = Math.min(100, boundedScore(seedHash, offset, 72, 88) + pageFitBonus(input.brief.pageType, direction));
  const readability = direction.typeContrast === "dramatic" && direction.density === "dense" ? 72 : boundedScore(seedHash, offset + 2, 82, 97);
  const positiveWeight = 0.77 + (originalityDistance === null ? 0 : 0.15);
  const positiveScore = (
    briefFit * 0.27 + differentiation * 0.18 + readability * 0.18 + risk.responsive * 0.14 + (originalityDistance ?? 0) * 0.15
  ) / positiveWeight;
  const total = Math.round(positiveScore - risk.accessibility * 0.03 - risk.complexity * 0.025 - risk.performance * 0.025);
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

function rotateDirections(seedHash: string): VisualDirectionDimensions[] {
  const start = Number.parseInt(seedHash.slice(0, 2), 16) % BASE_DIRECTIONS.length;
  return [0, 1, 2].map((offset) => BASE_DIRECTIONS[(start + offset) % BASE_DIRECTIONS.length]!).map((direction) => ({ ...direction }));
}

export function searchVisualDirections(
  input: CompilerInput,
  seed = "website-design-compiler/v2",
  verifiedReferences: readonly VerifiedVisualReference[] = []
): VisualDirectionSearchReceipt {
  const inputSha256 = visualDirectionInputSha256(input);
  const seedHash = hash({ seed, inputSha256, project: input.project });
  const observedReferences = verifiedReferences.map((reference) => reference.dimensions);
  const directions = rotateDirections(seedHash);
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
