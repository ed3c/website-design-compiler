import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { routeArtDirection } from "./art-direction.js";
import { buildReferenceManifest } from "./reference-intelligence.js";
import { validateAgainstSchema } from "./validate.js";

export interface DesignContractBundle {
  schema: "website-design-compiler/design-contract-bundle/v1";
  tokens: {
    colorRoles: string[];
    typeRoles: string[];
    spacing: string[];
    radii: string[];
    motion: { fastMs: number; baseMs: number; slowMs: number };
  };
  componentStates: Array<{ component: string; states: string[] }>;
  motion: {
    policy: "PURPOSE_REQUIRED";
    reducedMotion: "REQUIRED";
    allowedPurposes: string[];
  };
  scene: {
    policy: "OPTIONAL_PROGRESSIVE_ENHANCEMENT";
    fallback: "REQUIRED";
    loadPolicy: "LAZY_NON_BLOCKING";
  };
}

export function buildDesignContractBundle(): DesignContractBundle {
  return {
    schema: "website-design-compiler/design-contract-bundle/v1",
    tokens: {
      colorRoles: ["background", "surface", "text-primary", "text-muted", "accent", "critical"],
      typeRoles: ["display", "heading", "body", "label", "code"],
      spacing: ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"],
      radii: ["sm", "md", "lg", "full"],
      motion: { fastMs: 120, baseMs: 220, slowMs: 420 }
    },
    componentStates: [
      { component: "button", states: ["default", "hover", "focus", "active", "disabled", "loading"] },
      { component: "link", states: ["default", "hover", "focus", "visited"] },
      { component: "field", states: ["default", "focus", "invalid", "disabled"] },
      { component: "card", states: ["default", "hover", "focus-within"] }
    ],
    motion: {
      policy: "PURPOSE_REQUIRED",
      reducedMotion: "REQUIRED",
      allowedPurposes: ["feedback", "spatial-continuity", "causality", "hierarchy", "brand-expression"]
    },
    scene: {
      policy: "OPTIONAL_PROGRESSIVE_ENHANCEMENT",
      fallback: "REQUIRED",
      loadPolicy: "LAZY_NON_BLOCKING"
    }
  };
}

export async function writeDesignContracts(input: CompilerInput, outputDirectory: string): Promise<string[]> {
  if (!input.artDirection) throw new Error("art-direction stage requires input.artDirection selection");

  const referenceManifest = await buildReferenceManifest(input);
  const observedReferenceCount = referenceManifest.entries.filter((entry) => entry.captureState === "PASS").length;
  const designRead = routeArtDirection(input, input.artDirection, observedReferenceCount);
  const bundle = buildDesignContractBundle();

  await validateAgainstSchema(designRead, "design-read.schema.json");
  await validateAgainstSchema(bundle, "design-contract-bundle.schema.json");

  const directory = join(outputDirectory, "art-direction");
  await mkdir(directory, { recursive: true });
  const designReadPath = join(directory, "design-read.json");
  const designMdPath = join(directory, "DESIGN.md");
  const tokensPath = join(directory, "semantic-tokens.json");
  const statesPath = join(directory, "component-state-matrix.json");
  const motionPath = join(directory, "motion-spec.json");
  const scenePath = join(directory, "scene-spec.json");

  await writeFile(designReadPath, JSON.stringify(designRead, null, 2) + "\n");
  await writeFile(tokensPath, JSON.stringify(bundle.tokens, null, 2) + "\n");
  await writeFile(statesPath, JSON.stringify(bundle.componentStates, null, 2) + "\n");
  await writeFile(motionPath, JSON.stringify(bundle.motion, null, 2) + "\n");
  await writeFile(scenePath, JSON.stringify(bundle.scene, null, 2) + "\n");
  await writeFile(designMdPath, [
    "# DESIGN",
    "",
    `Primary authority: ${designRead.primaryAuthority}`,
    `Reviewers: ${designRead.reviewers.join(", ") || "none"}`,
    `Page type: ${designRead.pageType}`,
    `Audience: ${designRead.audience}`,
    `Objective: ${designRead.objective}`,
    `Reference evidence: ${designRead.referenceEvidenceState}`,
    "",
    "## Contract",
    "Semantic roles are fixed here; concrete brand values belong to the downstream implementation/design-system stage and must remain evidence- or brief-backed.",
    "Motion requires purpose and reduced-motion fallback. 3D/graphics are optional progressive enhancement with a required non-WebGL fallback.",
    ""
  ].join("\n"));

  return [designReadPath, designMdPath, tokensPath, statesPath, motionPath, scenePath];
}
