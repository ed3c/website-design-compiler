export const EVIDENCE_STATES = [
  "PASS", "FAIL", "ABSENT", "NOT_IMPLEMENTED", "NOT_EXERCISED", "SKIPPED_BY_POLICY"
] as const;

export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export const PIPELINE_STAGES = [
  "reference-intelligence",
  "art-direction",
  "information-architecture",
  "content-architecture",
  "visual-direction-search",
  "semantic-design-tokens",
  "design-system-compiler",
  "page-architect",
  "frontend-builder",
  "motion-director",
  "graphics-2d",
  "graphics-3d",
  "media-generator",
  "browser-visual-qa",
  "accessibility-performance",
  "originality-gate",
  "license-provenance",
  "release-receipt"
] as const;

export type PipelineStageName = (typeof PIPELINE_STAGES)[number];
export type ArtDirectorAuthority = "anthropic-frontend-design" | "google-stitch" | "taste-skill" | "repo-native";

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

export interface CompilerReference {
  kind: "url" | "image" | "video" | "html";
  value: string;
  visualEvidence?: {
    receiptPath: string;
    receiptSha256: string;
  };
}

export interface AuthoredContentEntry {
  value: string;
  source: {
    kind: "user-supplied" | "benchmark-fixture";
    uri: string;
  };
  evidence?: {
    kind: "source-excerpt";
    source: string;
    excerpt: string;
    sha256: string;
  };
}

export interface CompilerBriefSourceEvidence {
  inputSha256: string;
  fields: {
    pageType: { state: "EXPLICIT" | "INFERRED"; sourceExcerpt: string };
    audience: { state: "EXPLICIT" | "INFERRED"; sourceExcerpt: string };
    objective: { state: "EXPLICIT" | "INFERRED"; sourceExcerpt: string };
  };
}

export interface CompilerInput {
  schema: "website-design-compiler/input/v1";
  project: string;
  brief: {
    pageType: string;
    audience: string;
    objective: string;
  };
  hardConstraints?: string[];
  authoredContent?: Record<string, AuthoredContentEntry>;
  briefSourceEvidence?: CompilerBriefSourceEvidence;
  references?: CompilerReference[];
  artDirection?: { primary: ArtDirectorAuthority[]; reviewers?: ArtDirectorAuthority[]; };
  requestedStages: string[];
}

export interface StageEvidence { stage: string; state: EvidenceState; reason: string; artifacts: string[]; }

export interface StageExecutionEvidence {
  state: EvidenceState;
  reason: string;
  artifacts: string[];
}

export interface RuntimeReceipt {
  schema: "website-design-compiler/runtime-receipt/v1";
  project: string;
  generatedAt: string;
  inputSha256: string;
  runtime: { node: string; platform: string; arch: string; };
  stages: StageEvidence[];
  overall: EvidenceState;
}
