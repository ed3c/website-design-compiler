import { readFile } from "node:fs/promises";

export type BindingState = "PASS" | "FAIL" | "ABSENT";

export interface SharedBinding {
  name: string;
  purpose: string;
  optional?: boolean;
}

export interface SharedBindingsFile {
  schema: string;
  source: {
    repository: string;
    visibility: "private" | "public";
    registry: string;
    mode: string;
    expectedIdentity?: string;
  };
  bindings: SharedBinding[];
}

export interface RegistryProjectionEntry {
  name: string;
  identity: string;
}

export interface RegistryProjection {
  schema: "website-design-compiler/shared-registry-projection/v1";
  sourceRepository: string;
  sourceIdentity: string;
  skills: RegistryProjectionEntry[];
}

export interface BindingResolution {
  name: string;
  state: BindingState;
  optional: boolean;
  identity?: string;
  reason?: string;
}

export interface BindingReceipt {
  schema: "website-design-compiler/shared-binding-receipt/v1";
  sourceRepository: string;
  sourceIdentity: string;
  consumerIdentity: string;
  overall: BindingState;
  resolutions: BindingResolution[];
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export function resolveSharedBindings(
  bindingFile: SharedBindingsFile,
  projection: RegistryProjection,
  localSkillNames: readonly string[] = [],
  consumerIdentity = "NOT_EXERCISED"
): BindingReceipt {
  const failAll = (reason: string): BindingReceipt => ({
    schema: "website-design-compiler/shared-binding-receipt/v1",
    sourceRepository: projection.sourceRepository,
    sourceIdentity: projection.sourceIdentity,
    consumerIdentity,
    overall: "FAIL",
    resolutions: bindingFile.bindings.map((binding) => ({
      name: binding.name,
      optional: binding.optional ?? false,
      state: "FAIL",
      reason
    }))
  });

  if (projection.sourceRepository !== bindingFile.source.repository) {
    return failAll("registry projection source repository does not match binding source");
  }

  if (bindingFile.source.expectedIdentity && projection.sourceIdentity !== bindingFile.source.expectedIdentity) {
    return failAll("registry projection source identity does not match pinned binding identity");
  }

  const identities = new Map(projection.skills.map((skill) => [skill.name, skill.identity]));
  const local = new Set(localSkillNames);

  const resolutions = bindingFile.bindings.map<BindingResolution>((binding) => {
    const optional = binding.optional ?? false;

    if (local.has(binding.name)) {
      return {
        name: binding.name,
        optional,
        state: "FAIL",
        reason: "local skill shadows a canonical shared skill"
      };
    }

    const identity = identities.get(binding.name);
    if (!identity) {
      return {
        name: binding.name,
        optional,
        state: optional ? "ABSENT" : "FAIL",
        reason: optional ? "optional shared skill is absent" : "required shared skill is absent"
      };
    }

    return { name: binding.name, optional, state: "PASS", identity };
  });

  const requiredFailure = resolutions.some((entry) => entry.state === "FAIL");

  return {
    schema: "website-design-compiler/shared-binding-receipt/v1",
    sourceRepository: projection.sourceRepository,
    sourceIdentity: projection.sourceIdentity,
    consumerIdentity,
    overall: requiredFailure ? "FAIL" : "PASS",
    resolutions
  };
}
