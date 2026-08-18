import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildMediaCandidateRejectionReceipt } from "../src/media-candidate-rejection.js";
import {
  DeterministicMockMediaWorker,
  routeMediaGeneration,
  signMediaRequest,
  type MediaModelPolicy,
  type MediaRequest
} from "../src/media-router.js";

const root = process.cwd();
const policy = JSON.parse(await readFile(join(root, "fixtures", "media", "model-policy.json"), "utf8")) as MediaModelPolicy;
const request: MediaRequest = {
  schema: "website-design-compiler/media-request/v1",
  requestId: "fixture-media-001",
  kind: "image",
  modelId: "deterministic-mock-image-v1",
  prompt: "Neutral abstract compiler evidence diagram with no brand marks.",
  parameters: { width: 640, height: 360, seed: 7 },
  optimization: { target: "web", maxBytes: 65536 }
};

const secret = "ci-fixture-secret-not-a-production-credential";
const result = await routeMediaGeneration({
  signed: { request, signature: signMediaRequest(request, secret) },
  secret,
  policy,
  workers: { mock: new DeterministicMockMediaWorker() }
});

const outputDirectory = join(root, "artifacts", "media-generator");
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "media-generation-receipt.json"), `${JSON.stringify({
  ...result.receipt,
  git: { sha: process.env.GITHUB_SHA ?? "UNBOUND", ref: process.env.GITHUB_REF ?? "UNBOUND" },
  productCoreForbiddenImports: policy.productCoreForbiddenImports,
  workerIsolation: {
    diffusersImage: "BOUNDARY_ONLY",
    diffusersVideo: "BOUNDARY_ONLY",
    threeDWorker: "BOUNDARY_ONLY",
    wanGpProductCoreImport: "ABSENT"
  }
}, null, 2)}\n`, "utf8");
if (!result.asset) throw new Error(`deterministic mock generation failed: ${result.receipt.reason ?? "unknown"}`);
await writeFile(join(outputDirectory, `fixture.${result.asset.extension}`), result.asset.bytes);
const rejection = await buildMediaCandidateRejectionReceipt(root, {
  sha: process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
  ref: process.env.GITHUB_REF ?? execFileSync("git", ["symbolic-ref", "--quiet", "HEAD"], { encoding: "utf8" }).trim()
},new Date(),process.env.WDC_PRODUCTION_RIGHTS_EVIDENCE_SHA256?.trim()||undefined,process.env.WDC_PRODUCTION_CANDIDATE_TRUSTED_TREE?.trim()||undefined);
await writeFile(join(outputDirectory, "media-candidate-rejection.json"), `${JSON.stringify(rejection, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ overall: result.receipt.overall, assetSha256: result.receipt.asset?.sha256, bytes: result.receipt.asset?.bytes, candidateRejection:rejection.overall,rejectedCandidates: rejection.candidates.map((candidate) => candidate.modelId) }));
if (result.receipt.overall !== "PASS") process.exitCode = 1;
