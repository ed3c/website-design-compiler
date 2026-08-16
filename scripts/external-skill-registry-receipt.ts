import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveExternalSkillRegistry,
  type ExternalSkillRegistry,
  type ExternalSkillCapability
} from "../src/external-skill-registry.js";

interface UpstreamEvidenceEntry {
  id: string;
  repository: string;
  commit: string;
  skillPath: string;
  skillBlob: string;
  licenseSpdx: string;
  licensePath: string;
  licenseBlob: string;
}
interface UpstreamEvidence {
  schema: "website-design-compiler/external-skill-upstream-evidence/v1";
  verifiedAt: string;
  verificationMode: "github-api-exact-commit-metadata";
  entries: UpstreamEvidenceEntry[];
}

const root = process.cwd();
const registryPath = join(root, ".skill-bindings", "external-design-skills.json");
const evidencePath = join(root, "fixtures", "external-skills", "upstream-evidence.json");
const outputDirectory = join(root, "artifacts", "external-skills");
const outputPath = join(outputDirectory, "registry-receipt.json");

const registry = JSON.parse(await readFile(registryPath, "utf8")) as ExternalSkillRegistry;
const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as UpstreamEvidence;
const registryReceipt = resolveExternalSkillRegistry(registry);
const evidenceById = new Map(evidence.entries.map((entry) => [entry.id, entry]));
const evidenceChecks = registry.entries.filter((entry) => entry.enabled).map((entry) => {
  const observed = evidenceById.get(entry.id);
  if (!observed) return { id: entry.id, state: "FAIL" as const, reason: "enabled registry entry has no upstream evidence snapshot" };
  const matches =
    observed.repository === entry.source.repository &&
    observed.commit === entry.source.commit &&
    observed.skillPath === entry.source.path &&
    observed.skillBlob === entry.source.blob &&
    observed.licenseSpdx === entry.license.spdx &&
    observed.licensePath === entry.license.evidencePath &&
    observed.licenseBlob === entry.license.evidenceBlob;
  return matches
    ? { id: entry.id, state: "PASS" as const }
    : { id: entry.id, state: "FAIL" as const, reason: "registry identity/license metadata drifted from verified upstream evidence" };
});

const admittedCapabilities = [...new Set(registry.entries.filter((entry) => entry.enabled).map((entry) => entry.capability))].sort() as ExternalSkillCapability[];
const overall = registryReceipt.overall === "PASS" && evidenceChecks.every((entry) => entry.state === "PASS") ? "PASS" : "FAIL";
const receipt = {
  schema: "website-design-compiler/external-skill-registry-admission-receipt/v1",
  overall,
  git: {
    sha: process.env.GITHUB_SHA ?? "UNBOUND",
    ref: process.env.GITHUB_REF ?? "UNBOUND"
  },
  registry: ".skill-bindings/external-design-skills.json",
  upstreamEvidence: "fixtures/external-skills/upstream-evidence.json",
  upstreamVerifiedAt: evidence.verifiedAt,
  verificationMode: evidence.verificationMode,
  mode: registry.mode,
  primaryArtDirector: registryReceipt.primaryArtDirector,
  enabledCount: registryReceipt.enabledCount,
  capabilitySlots: registryReceipt.capabilitySlots,
  admittedCapabilities,
  evalsRequiredOnIdentityChange: admittedCapabilities,
  registryResolutions: registryReceipt.resolutions,
  evidenceChecks,
  vendoredBodies: "ABSENT"
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath: outputPath, overall, enabledCount: receipt.enabledCount, admittedCapabilities }));
if (overall !== "PASS") process.exitCode = 1;
