export type ExternalSkillState = "PASS" | "FAIL" | "NOT_ADMITTED";
export type ExternalSkillCapability =
  | "reference-intelligence"
  | "art-direction"
  | "frontend-engineering"
  | "motion"
  | "shadcn"
  | "browser-qa";
export type ExternalSkillAuthority = "primary" | "reviewer" | "specialist";

export interface ExternalSkillEntry {
  id: string;
  enabled: boolean;
  capability: ExternalSkillCapability;
  authority: ExternalSkillAuthority;
  source: {
    repository: string;
    commit: string;
    path: string;
    blob: string;
  };
  license: {
    spdx: string;
    evidencePath: string;
    evidenceBlob: string;
  };
  bodyPolicy: "REMOTE_REFERENCE_ONLY";
}

export interface ExternalSkillRegistry {
  schema: "website-design-compiler/external-skill-registry/v1";
  mode: "reference-only-no-vendoring";
  localPrimaryArtDirector: string;
  capabilitySlots: Record<ExternalSkillCapability, ExternalSkillState>;
  entries: ExternalSkillEntry[];
}

export interface ExternalSkillResolution {
  id: string;
  state: "PASS" | "FAIL";
  identity?: string;
  reason?: string;
}

export interface ExternalSkillRegistryReceipt {
  schema: "website-design-compiler/external-skill-registry-receipt/v1";
  overall: "PASS" | "FAIL";
  mode: "reference-only-no-vendoring";
  primaryArtDirector: string;
  enabledCount: number;
  resolutions: ExternalSkillResolution[];
  capabilitySlots: Record<ExternalSkillCapability, ExternalSkillState>;
}

const capabilities = new Set<ExternalSkillCapability>([
  "reference-intelligence",
  "art-direction",
  "frontend-engineering",
  "motion",
  "shadcn",
  "browser-qa"
]);

const fortyHex = /^[a-f0-9]{40}$/;
const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const spdxToken = /^[A-Za-z0-9-.+]+$/;

function validateEntry(entry: ExternalSkillEntry, localPrimaryArtDirector: string): ExternalSkillResolution {
  const fail = (reason: string): ExternalSkillResolution => ({ id: entry.id, state: "FAIL", reason });
  if (!entry.enabled) return fail("disabled entries must not enter the enabled registry resolution set");
  if (!entry.id.trim()) return fail("external skill id is empty");
  if (!capabilities.has(entry.capability)) return fail("unknown external skill capability");
  if (!repositoryName.test(entry.source.repository)) return fail("source repository must be owner/name");
  if (!fortyHex.test(entry.source.commit)) return fail("source commit must be an exact 40-hex git commit");
  if (!entry.source.path.endsWith("/SKILL.md")) return fail("source path must identify a SKILL.md");
  if (!fortyHex.test(entry.source.blob)) return fail("source blob must be an exact 40-hex git blob identity");
  if (!spdxToken.test(entry.license.spdx)) return fail("license must have an SPDX-like identifier");
  if (!entry.license.evidencePath.trim()) return fail("license evidence path is required");
  if (!fortyHex.test(entry.license.evidenceBlob)) return fail("license evidence blob must be exact");
  if (entry.bodyPolicy !== "REMOTE_REFERENCE_ONLY") return fail("external skill bodies must remain remote-reference-only");
  if (entry.capability === "art-direction" && entry.authority === "primary") {
    return fail(`external primary art director conflicts with ${localPrimaryArtDirector}`);
  }
  return {
    id: entry.id,
    state: "PASS",
    identity: `git:${entry.source.repository}@${entry.source.commit}:${entry.source.path}#${entry.source.blob}`
  };
}

export function resolveExternalSkillRegistry(registry: ExternalSkillRegistry): ExternalSkillRegistryReceipt {
  const resolutions: ExternalSkillResolution[] = [];
  const ids = new Set<string>();
  const enabled = registry.entries.filter((entry) => entry.enabled);

  if (registry.mode !== "reference-only-no-vendoring") {
    resolutions.push({ id: "registry-mode", state: "FAIL", reason: "registry mode permits vendoring" });
  }
  if (!registry.localPrimaryArtDirector.trim()) {
    resolutions.push({ id: "primary-art-director", state: "FAIL", reason: "local primary art director is missing" });
  }

  for (const entry of enabled) {
    if (ids.has(entry.id)) {
      resolutions.push({ id: entry.id, state: "FAIL", reason: "duplicate enabled external skill id" });
      continue;
    }
    ids.add(entry.id);
    resolutions.push(validateEntry(entry, registry.localPrimaryArtDirector));
  }

  const enabledByCapability = new Map<ExternalSkillCapability, number>();
  for (const entry of enabled) enabledByCapability.set(entry.capability, (enabledByCapability.get(entry.capability) ?? 0) + 1);
  for (const capability of capabilities) {
    const expected = registry.capabilitySlots[capability];
    const count = enabledByCapability.get(capability) ?? 0;
    if (expected === "PASS" && count === 0) {
      resolutions.push({ id: `slot:${capability}`, state: "FAIL", reason: "capability slot claims PASS without an enabled pinned skill" });
    }
    if (expected === "NOT_ADMITTED" && count > 0) {
      resolutions.push({ id: `slot:${capability}`, state: "FAIL", reason: "capability slot claims NOT_ADMITTED while an enabled skill exists" });
    }
    if (expected === "FAIL") {
      resolutions.push({ id: `slot:${capability}`, state: "FAIL", reason: "capability slot is explicitly FAIL" });
    }
  }

  return {
    schema: "website-design-compiler/external-skill-registry-receipt/v1",
    overall: resolutions.every((resolution) => resolution.state === "PASS") ? "PASS" : "FAIL",
    mode: registry.mode,
    primaryArtDirector: registry.localPrimaryArtDirector,
    enabledCount: enabled.length,
    resolutions,
    capabilitySlots: registry.capabilitySlots
  };
}

export function changedExternalSkillCapabilities(
  previous: ExternalSkillRegistry,
  current: ExternalSkillRegistry
): ExternalSkillCapability[] {
  const identity = (entry: ExternalSkillEntry) =>
    `${entry.enabled}:${entry.source.repository}:${entry.source.commit}:${entry.source.path}:${entry.source.blob}:${entry.license.spdx}:${entry.license.evidenceBlob}:${entry.authority}`;
  const previousById = new Map(previous.entries.map((entry) => [entry.id, identity(entry)]));
  const changed = new Set<ExternalSkillCapability>();
  for (const entry of current.entries) {
    if (previousById.get(entry.id) !== identity(entry)) changed.add(entry.capability);
  }
  const currentIds = new Set(current.entries.map((entry) => entry.id));
  for (const entry of previous.entries) {
    if (!currentIds.has(entry.id)) changed.add(entry.capability);
  }
  return [...changed].sort();
}
