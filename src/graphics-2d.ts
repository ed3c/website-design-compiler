import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateAgainstSchema } from "./validate.js";

export interface Graphics2DPlan {
  schema: "website-design-compiler/graphics-2d-plan/v1";
  engine: "pixi.js";
  rendererPolicy: {
    preferred: "webgl";
    capabilityOrder: ["webgpu", "webgl", "canvas2d"];
    progressiveEnhancement: true;
  };
  dprPolicy: { desktopMax: 2; coarsePointerMax: 1.5 };
  scene: {
    id: "runtime-orbit";
    purpose: "illustration";
    criticalContent: false;
    proceduralObjects: 4;
  };
  fallback: {
    semanticDom: "REQUIRED";
    staticPoster: "REQUIRED";
    forcedTestHook: "graphics=off";
  };
  lifecycle: {
    lazyImport: true;
    privateTicker: true;
    removeListeners: true;
    destroyApplication: true;
  };
  assetBudget: {
    externalBytes: 0;
    textureBytes: 0;
    maxExternalBytes: 262144;
  };
}

export function buildGraphics2DPlan(): Graphics2DPlan {
  return {
    schema: "website-design-compiler/graphics-2d-plan/v1",
    engine: "pixi.js",
    rendererPolicy: {
      preferred: "webgl",
      capabilityOrder: ["webgpu", "webgl", "canvas2d"],
      progressiveEnhancement: true
    },
    dprPolicy: { desktopMax: 2, coarsePointerMax: 1.5 },
    scene: {
      id: "runtime-orbit",
      purpose: "illustration",
      criticalContent: false,
      proceduralObjects: 4
    },
    fallback: {
      semanticDom: "REQUIRED",
      staticPoster: "REQUIRED",
      forcedTestHook: "graphics=off"
    },
    lifecycle: {
      lazyImport: true,
      privateTicker: true,
      removeListeners: true,
      destroyApplication: true
    },
    assetBudget: {
      externalBytes: 0,
      textureBytes: 0,
      maxExternalBytes: 262144
    }
  };
}

export async function writeGraphics2DPlan(outputDirectory: string): Promise<string> {
  const plan = buildGraphics2DPlan();
  await validateAgainstSchema(plan, "graphics-2d-plan.schema.json");
  const directory = join(outputDirectory, "graphics-2d");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "graphics-2d-plan.json");
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}
