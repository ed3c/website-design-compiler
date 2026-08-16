import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateMediaModelPolicy, type MediaModelPolicy } from "./media-router.js";

export interface MediaGeneratorPlan {
  schema: "website-design-compiler/media-generator-plan/v1";
  executionOwnership: "isolated-worker";
  pageRuntimeDependency: "NONE";
  authentication: "HMAC-SHA256";
  queue: {
    retry: "BOUNDED";
    cancellation: "SUPPORTED";
  };
  optimizationHandoff: "REQUIRED";
  provenance: {
    assetHash: "SHA256";
    promptHash: "SHA256";
    modelVersionOrCommit: "REQUIRED";
    parameters: "RECORDED";
    modelRightsSubject: "REQUIRED";
    outputTermsSubject: "REQUIRED";
  };
  adapters: {
    mock: "EXECUTABLE";
    diffusersImage: "BOUNDARY_ONLY";
    diffusersVideo: "BOUNDARY_ONLY";
    threeDWorker: "BOUNDARY_ONLY";
  };
  productCoreForbiddenImports: string[];
  admittedModels: string[];
  reviewRequiredModels: string[];
  deniedModels: string[];
}

export async function buildMediaGeneratorPlan(policyPath = join(process.cwd(), "fixtures", "media", "model-policy.json")): Promise<MediaGeneratorPlan> {
  const policy = JSON.parse(await readFile(policyPath, "utf8")) as MediaModelPolicy;
  const errors = validateMediaModelPolicy(policy);
  if (errors.length > 0) throw new Error(`invalid media model policy: ${errors.join("; ")}`);
  return {
    schema: "website-design-compiler/media-generator-plan/v1",
    executionOwnership: "isolated-worker",
    pageRuntimeDependency: "NONE",
    authentication: "HMAC-SHA256",
    queue: { retry: "BOUNDED", cancellation: "SUPPORTED" },
    optimizationHandoff: "REQUIRED",
    provenance: {
      assetHash: "SHA256",
      promptHash: "SHA256",
      modelVersionOrCommit: "REQUIRED",
      parameters: "RECORDED",
      modelRightsSubject: "REQUIRED",
      outputTermsSubject: "REQUIRED"
    },
    adapters: {
      mock: "EXECUTABLE",
      diffusersImage: "BOUNDARY_ONLY",
      diffusersVideo: "BOUNDARY_ONLY",
      threeDWorker: "BOUNDARY_ONLY"
    },
    productCoreForbiddenImports: [...policy.productCoreForbiddenImports].sort(),
    admittedModels: policy.entries.filter((entry) => entry.admission === "ALLOW").map((entry) => entry.id).sort(),
    reviewRequiredModels: policy.entries.filter((entry) => entry.admission === "REVIEW_REQUIRED").map((entry) => entry.id).sort(),
    deniedModels: policy.entries.filter((entry) => entry.admission === "DENY").map((entry) => entry.id).sort()
  };
}

export async function writeMediaGeneratorPlan(outputDirectory: string): Promise<string> {
  const directory = join(outputDirectory, "media-generator");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "media-generator-plan.json");
  await writeFile(path, `${JSON.stringify(await buildMediaGeneratorPlan(), null, 2)}\n`, "utf8");
  return path;
}
