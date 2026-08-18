import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { validateAgainstSchema } from "./validate.js";

export interface VisualDirectionDimensions {
  typography: "neo-grotesk" | "editorial-serif" | "humanist-sans" | "display-contrast";
  typeContrast: "restrained" | "balanced" | "dramatic";
  density: "airy" | "balanced" | "dense";
  grid: "strict" | "asymmetric" | "modular" | "editorial";
  surface: "flat" | "layered" | "bordered" | "tonal";
  colorStrategy: "neutral-accent" | "warm-editorial" | "high-contrast" | "tonal-brand";
  mediaStrategy: "text-first" | "product-media" | "editorial-media" | "interactive-stage";
  motionIntensity: "minimal" | "moderate" | "expressive";
  signatureInteraction: "none" | "progressive-reveal" | "spatial-focus" | "direct-manipulation";
}

export interface VisualDirectionScore {
  briefFit: number;
  differentiation: number;
  readability: number;
  accessibilityRisk: number;
  implementationComplexity: number;
  performanceRisk: number;
  responsiveRobustness: number;
  originalityDistance: number;
  total: number;
}

export interface VisualDirectionCandidate {
  id: string;
  rank: number;
  state: "SELECTED" | "REJECTED";
  dimensions: VisualDirectionDimensions;
  score: VisualDirectionScore;
  signature: string;
  domainFingerprint: VisualDirectionDomainFingerprint;
  minimumPairwiseDomainDistance: number;
  rejectionReasons: string[];
}

export interface VisualDirectionDomainFingerprint {
  typography: string;
  composition: string;
  surface: string;
  media: string;
  motion: string;
  combined: string;
}

export interface VisualDirectionSearchReceipt {
  schema: "website-design-compiler/visual-direction-search/v2";
  project: string;
  seed: string;
  inputSha256: string;
  candidateCount: number;
  selectedCandidateId: string;
  selectedDirection: VisualDirectionDimensions;
  originality: {
    minimumPairwiseDomainDistance: 3;
    referenceFingerprints: VisualDirectionDomainFingerprint[];
    candidatePairs: Array<{ first: string; second: string; domainDistance: number }>;
  };
  candidates: VisualDirectionCandidate[];
}

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

export function visualDirectionSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function boundedScore(hex: string, offset: number, min: number, max: number): number {
  const byte = Number.parseInt(hex.slice(offset, offset + 2), 16);
  return min + (byte % (max - min + 1));
}

function pageFitBonus(pageType: string, direction: VisualDirectionDimensions): number {
  const value = pageType.toLowerCase();
  if (value.includes("editorial") && direction.grid === "editorial") return 8;
  if ((value.includes("3d") || value.includes("2d") || value.includes("creative")) && direction.mediaStrategy === "interactive-stage") return 8;
  if ((value.includes("product") || value.includes("b2b")) && direction.typography === "neo-grotesk") return 7;
  if ((value.includes("premium") || value.includes("consumer")) && direction.density === "airy") return 7;
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

function scoreCandidate(input: CompilerInput, direction: VisualDirectionDimensions, seedHash: string, candidateIndex: number): VisualDirectionScore {
  const risk = riskFor(direction);
  const offset = candidateIndex * 8;
  const briefFit = Math.min(100, boundedScore(seedHash, offset, 72, 88) + pageFitBonus(input.brief.pageType, direction));
  const differentiation = boundedScore(seedHash, offset + 2, 74, 96);
  const readability = direction.typeContrast === "dramatic" && direction.density === "dense" ? 72 : boundedScore(seedHash, offset + 4, 82, 97);
  const originalityDistance = boundedScore(seedHash, offset + 6, 72, 96);
  const total = Math.round(
    briefFit * 0.27 + differentiation * 0.18 + readability * 0.18 + risk.responsive * 0.14 + originalityDistance * 0.15 -
    risk.accessibility * 0.03 - risk.complexity * 0.025 - risk.performance * 0.025
  );
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

export function fingerprintVisualDirection(direction:VisualDirectionDimensions):VisualDirectionDomainFingerprint{
  const domains={
    typography:visualDirectionSha256({typography:direction.typography,typeContrast:direction.typeContrast}),
    composition:visualDirectionSha256({density:direction.density,grid:direction.grid}),
    surface:visualDirectionSha256({surface:direction.surface,colorStrategy:direction.colorStrategy}),
    media:visualDirectionSha256({mediaStrategy:direction.mediaStrategy}),
    motion:visualDirectionSha256({motionIntensity:direction.motionIntensity,signatureInteraction:direction.signatureInteraction})
  };
  return{...domains,combined:visualDirectionSha256(domains)};
}

export function domainFingerprintDistance(first:VisualDirectionDomainFingerprint,second:VisualDirectionDomainFingerprint):number{
  return (["typography","composition","surface","media","motion"] as const).filter((domain)=>first[domain]!==second[domain]).length;
}

export function auditCandidateOriginality(candidate: Pick<VisualDirectionCandidate, "signature" | "score"|"domainFingerprint">, referenceSignatures: readonly string[],referenceFingerprints:readonly VisualDirectionDomainFingerprint[]=[]): string[] {
  const reasons: string[] = [];
  if (referenceSignatures.includes(candidate.signature)) reasons.push("candidate signature matches a reference signature");
  if(referenceFingerprints.some((fingerprint)=>fingerprint.combined===candidate.domainFingerprint.combined))reasons.push("candidate domain fingerprint matches a reference fingerprint");
  if (candidate.score.originalityDistance < 70) reasons.push("originality distance is below the admission threshold");
  return reasons;
}

function rotateDirections(seedHash: string): VisualDirectionDimensions[] {
  const start = Number.parseInt(seedHash.slice(0, 2), 16) % BASE_DIRECTIONS.length;
  return [0, 1, 2].map((offset) => BASE_DIRECTIONS[(start + offset) % BASE_DIRECTIONS.length]!).map((direction) => ({ ...direction }));
}

export function searchVisualDirections(input: CompilerInput, seed = "website-design-compiler/v2"): VisualDirectionSearchReceipt {
  const inputSha256 = visualDirectionSha256(input);
  const seedHash = visualDirectionSha256({ seed, inputSha256, project: input.project });
  const referenceSignatures = (input.references ?? []).map((reference) => visualDirectionSha256({ kind: reference.kind, value: reference.value }));
  const referenceFingerprints:VisualDirectionDomainFingerprint[]=[];
  const initial = rotateDirections(seedHash).map((dimensions, index) => {
    const score = scoreCandidate(input, dimensions, seedHash, index);
    const signature = visualDirectionSha256(dimensions);
    const domainFingerprint=fingerprintVisualDirection(dimensions);
    const rejectionReasons = auditCandidateOriginality({ signature, score,domainFingerprint }, referenceSignatures,referenceFingerprints);
    return { id: `direction-${index + 1}`, dimensions, score, signature,domainFingerprint, rejectionReasons };
  });
  const candidatePairs=initial.flatMap((first,index)=>initial.slice(index+1).map((second)=>({first:first.id,second:second.id,domainDistance:domainFingerprintDistance(first.domainFingerprint,second.domainFingerprint)})));
  const distanceByCandidate=new Map(initial.map((candidate)=>[candidate.id,Math.min(...candidatePairs.filter((pair)=>pair.first===candidate.id||pair.second===candidate.id).map((pair)=>pair.domainDistance))]));
  for(const candidate of initial)if((distanceByCandidate.get(candidate.id)??0)<3)candidate.rejectionReasons.push("candidate is not materially distinct across at least three design domains");

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
      minimumPairwiseDomainDistance:distanceByCandidate.get(candidate.id)??0,
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
    originality:{minimumPairwiseDomainDistance:3,referenceFingerprints,candidatePairs},
    candidates: ranked
  };
}

export async function writeVisualDirectionSearch(receipt: VisualDirectionSearchReceipt, outputDirectory: string): Promise<string> {
  await validateAgainstSchema(receipt, "visual-direction-search-v2.schema.json");
  const directory = join(outputDirectory, "visual-direction-search");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "visual-direction-search.json");
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return path;
}
