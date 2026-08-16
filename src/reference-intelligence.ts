import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput, CompilerReference, EvidenceState } from "./contracts.js";
import { captureReference } from "./reference-capture.js";
import { validateAgainstSchema } from "./validate.js";

export interface ReferenceManifestEntry {
  id: string;
  kind: CompilerReference["kind"];
  source: string;
  captureState: EvidenceState;
  observableFacts: string[];
  unknownImplementationDetails: true;
  provenance: {
    adapter: string;
    sourceKind: CompilerReference["kind"];
    sourceMode: "INLINE" | "FILE" | "REMOTE" | "UNEXERCISED";
    finalUrl?: string;
    httpStatus?: number;
    contentType?: string;
    responseSha256?: string;
  };
  reason?: string;
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

export async function buildReferenceManifest(input: CompilerInput): Promise<ReferenceManifest> {
  const entries = await Promise.all(
    (input.references ?? []).map(async (reference, index): Promise<ReferenceManifestEntry> => {
      const capture = await captureReference(reference);
      return {
        id: `ref-${String(index + 1).padStart(3, "0")}`,
        kind: reference.kind,
        source: reference.value,
        captureState: capture.state,
        observableFacts: capture.facts,
        unknownImplementationDetails: true,
        provenance: capture.provenance,
        ...(capture.reason ? { reason: capture.reason } : {})
      };
    })
  );

  return {
    schema: "website-design-compiler/reference-manifest/v1",
    project: input.project,
    entries
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

function originalityPlanMarkdown(plan: OriginalityPlan): string {
  return [
    "# Originality Plan",
    "",
    `Policy: ${plan.policy}`,
    "",
    "## Retain only as evidence-backed grammar",
    "",
    ...plan.retain.map((item) => `- ${item}`),
    "",
    "## Transform",
    "",
    ...plan.transform.map((item) => `- ${item}`),
    "",
    "## Reject from implementation inputs",
    "",
    ...plan.reject.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

export async function writeReferenceIntelligenceArtifacts(
  input: CompilerInput,
  outputDirectory: string
): Promise<string[]> {
  const directory = join(outputDirectory, "reference-intelligence");
  await mkdir(directory, { recursive: true });

  const manifest = await buildReferenceManifest(input);
  const originalityPlan = buildOriginalityPlan();
  await validateAgainstSchema<ReferenceManifest>(manifest, "reference-manifest.schema.json");
  await validateAgainstSchema<OriginalityPlan>(originalityPlan, "originality-plan.schema.json");

  const manifestPath = join(directory, "reference-manifest.json");
  const originalityJsonPath = join(directory, "originality-plan.json");
  const originalityMarkdownPath = join(directory, "originality-plan.md");
  const analysisPath = join(directory, "reference-analysis.md");

  const observed = manifest.entries.filter((entry) => entry.captureState === "PASS");
  const pending = manifest.entries.filter((entry) => entry.captureState !== "PASS");
  const factLines = observed.flatMap((entry) => [
    `## ${entry.id} (${entry.kind})`,
    "",
    ...(entry.observableFacts.length > 0
      ? entry.observableFacts.map((fact) => `- ${fact}`)
      : ["- Capture succeeded but no supported observable facts were found."]),
    ""
  ]);

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(originalityJsonPath, `${JSON.stringify(originalityPlan, null, 2)}\n`, "utf8");
  await writeFile(originalityMarkdownPath, originalityPlanMarkdown(originalityPlan), "utf8");
  await writeFile(
    analysisPath,
    [
      "# Reference Analysis",
      "",
      `Project: ${input.project}`,
      "",
      `Observed references: ${observed.length}`,
      `Not fully observed references: ${pending.length}`,
      "",
      "Only adapter-observed facts are listed below. Source implementation details remain explicitly unknown.",
      "",
      ...factLines
    ].join("\n"),
    "utf8"
  );

  return [manifestPath, analysisPath, originalityJsonPath, originalityMarkdownPath];
}
