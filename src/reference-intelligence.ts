import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput, CompilerReference, EvidenceState } from "./contracts.js";

export interface ReferenceManifestEntry {
  id: string;
  kind: CompilerReference["kind"];
  source: string;
  captureState: EvidenceState;
  observableFacts: string[];
  unknownImplementationDetails: true;
}

export interface ReferenceManifest {
  schema: "website-design-compiler/reference-manifest/v1";
  project: string;
  entries: ReferenceManifestEntry[];
}

export interface OriginalityPlan {
  schema: "website-design-compiler/originality-plan/v1";
  policy: "GRAMMAR_ONLY_NO_IDENTITY_CLONING";
  retain: string[];
  transform: string[];
  reject: string[];
}

export function buildReferenceManifest(input: CompilerInput): ReferenceManifest {
  return {
    schema: "website-design-compiler/reference-manifest/v1",
    project: input.project,
    entries: (input.references ?? []).map((reference, index) => ({
      id: `ref-${String(index + 1).padStart(3, "0")}`,
      kind: reference.kind,
      source: reference.value,
      captureState: "NOT_EXERCISED",
      observableFacts: [],
      unknownImplementationDetails: true
    }))
  };
}

export function buildOriginalityPlan(): OriginalityPlan {
  return {
    schema: "website-design-compiler/originality-plan/v1",
    policy: "GRAMMAR_ONLY_NO_IDENTITY_CLONING",
    retain: [
      "layout grammar after evidence-backed analysis",
      "interaction grammar after evidence-backed analysis",
      "motion principles after evidence-backed analysis"
    ],
    transform: [
      "composition",
      "typography",
      "visual identity",
      "copy",
      "illustration and media assets"
    ],
    reject: [
      "trademarks and logos",
      "proprietary copy",
      "unlicensed media",
      "one-to-one page reproduction",
      "invented implementation details"
    ]
  };
}

export async function writeReferenceIntelligenceArtifacts(
  input: CompilerInput,
  outputDirectory: string
): Promise<string[]> {
  const directory = join(outputDirectory, "reference-intelligence");
  await mkdir(directory, { recursive: true });

  const manifest = buildReferenceManifest(input);
  const originalityPlan = buildOriginalityPlan();
  const manifestPath = join(directory, "reference-manifest.json");
  const originalityPath = join(directory, "originality-plan.json");
  const analysisPath = join(directory, "reference-analysis.md");

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(originalityPath, `${JSON.stringify(originalityPlan, null, 2)}\n`, "utf8");
  await writeFile(
    analysisPath,
    [
      "# Reference Analysis",
      "",
      `Project: ${input.project}`,
      "",
      "Reference inputs are normalized, but remote/image/video/HTML capture has not been exercised by this adapter yet.",
      "Observable facts therefore remain empty and implementation details remain explicitly unknown.",
      ""
    ].join("\n"),
    "utf8"
  );

  return [manifestPath, analysisPath, originalityPath];
}
