import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildLicenseReceipt, hashAssetFile, loadLicensePolicy, type ProvenanceSubject } from "./license-provenance.js";
import { validateAgainstSchema } from "./validate.js";

const IMG2THREEJS_COMMIT = "d6673386f89673a58736f8d398dd16ece67874f5";

export interface Graphics3DPlan {
  schema: "website-design-compiler/graphics-3d-plan/v1";
  engine: { renderer: "webgl"; three: "0.184.0"; reactThreeFiber: "9.6.1" };
  scene: { id: "procedural-proof"; purpose: "illustration"; criticalContent: false; frameloop: "demand" };
  camera: { type: "perspective"; position: [number, number, number]; fov: number; near: number; far: number };
  lights: Array<{ type: "ambient" | "directional" | "hemisphere"; intensity: number }>;
  materials: { policy: "standard-only-fixture"; maxMaterials: number };
  interaction: { pointerRequired: false; primaryActionDependency: false };
  lod: { policy: "procedural-complexity-cap"; mobileSimplification: true };
  dprPolicy: { desktopMax: 1.75; coarsePointerMax: 1.25 };
  fallback: { semanticDom: "REQUIRED"; staticPoster: "REQUIRED"; failedWebglHook: "graphics3d=off" };
  lifecycle: { lazyChunk: true; frameloopDemand: true; disposeGeneratedGeometry: true; disposeGeneratedMaterial: true };
  assetBudget: { externalBytes: 0; textureBytes: 0; maxTriangles: number; maxDrawCalls: number };
  proceduralAdapter: {
    name: "img2threejs";
    sourceRepository: "img2threejs/img2threejs";
    sourceCommit: string;
    sourceLicense: "Apache-2.0";
    factoryContract: "THREE.Group";
    semantics: ["pivots", "sockets", "colliders"];
    provenanceRequired: true;
  };
  experimental: { webgpuTsl: "NOT_EXERCISED" };
}

export function buildGraphics3DPlan(): Graphics3DPlan {
  return {
    schema: "website-design-compiler/graphics-3d-plan/v1",
    engine: { renderer: "webgl", three: "0.184.0", reactThreeFiber: "9.6.1" },
    scene: { id: "procedural-proof", purpose: "illustration", criticalContent: false, frameloop: "demand" },
    camera: { type: "perspective", position: [2.8, 2, 4.2], fov: 42, near: 0.1, far: 50 },
    lights: [
      { type: "ambient", intensity: 0.85 },
      { type: "directional", intensity: 1.45 },
      { type: "directional", intensity: 0.55 }
    ],
    materials: { policy: "standard-only-fixture", maxMaterials: 3 },
    interaction: { pointerRequired: false, primaryActionDependency: false },
    lod: { policy: "procedural-complexity-cap", mobileSimplification: true },
    dprPolicy: { desktopMax: 1.75, coarsePointerMax: 1.25 },
    fallback: { semanticDom: "REQUIRED", staticPoster: "REQUIRED", failedWebglHook: "graphics3d=off" },
    lifecycle: { lazyChunk: true, frameloopDemand: true, disposeGeneratedGeometry: true, disposeGeneratedMaterial: true },
    assetBudget: { externalBytes: 0, textureBytes: 0, maxTriangles: 2500, maxDrawCalls: 8 },
    proceduralAdapter: {
      name: "img2threejs",
      sourceRepository: "img2threejs/img2threejs",
      sourceCommit: IMG2THREEJS_COMMIT,
      sourceLicense: "Apache-2.0",
      factoryContract: "THREE.Group",
      semantics: ["pivots", "sockets", "colliders"],
      provenanceRequired: true
    },
    experimental: { webgpuTsl: "NOT_EXERCISED" }
  };
}

export async function buildProceduralFixtureProvenance(): Promise<ProvenanceSubject> {
  const sourcePath = resolve(process.cwd(), "apps/site/components/graphics/procedural-fixture.ts");
  const hashSha256 = await hashAssetFile(sourcePath);
  return {
    id: "generated:procedural-proof-fixture",
    kind: "generated-output",
    role: "optional",
    license: "CC0-1.0",
    versionOrCommit: `sha256:${hashSha256}`,
    source: "repository://apps/site/components/graphics/procedural-fixture.ts",
    attribution: `img2threejs-compatible adapter contract pinned to ${IMG2THREEJS_COMMIT}; fixture authored in-repository`,
    hashSha256,
    outputTerms: "Repository test fixture is recorded as CC0-1.0 for deterministic redistribution testing; this does not assert img2threejs output licensing."
  };
}

export async function writeGraphics3DArtifacts(outputDirectory: string): Promise<string[]> {
  const plan = buildGraphics3DPlan();
  await validateAgainstSchema(plan, "graphics-3d-plan.schema.json");
  const provenance = await buildProceduralFixtureProvenance();
  const provenanceReceipt = buildLicenseReceipt([provenance], await loadLicensePolicy());
  if (provenanceReceipt.overall !== "PASS") {
    throw new Error(`procedural fixture provenance must PASS, got ${provenanceReceipt.overall}`);
  }

  const directory = join(outputDirectory, "graphics-3d");
  await mkdir(directory, { recursive: true });
  const planPath = join(directory, "graphics-3d-plan.json");
  const provenancePath = join(directory, "procedural-provenance.json");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await writeFile(provenancePath, `${JSON.stringify(provenanceReceipt, null, 2)}\n`, "utf8");
  return [planPath, provenancePath];
}
