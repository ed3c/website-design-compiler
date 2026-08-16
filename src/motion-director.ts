import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompilerInput } from "./contracts.js";
import { validateAgainstSchema } from "./validate.js";

export type MotionEngine = "motion" | "gsap";

export interface MotionEffectContract {
  id: string;
  engine: MotionEngine;
  target: string;
  purpose: "feedback" | "spatial-continuity" | "causality" | "hierarchy" | "brand-expression";
  trigger: "mount" | "interaction" | "scroll";
  durationMs: number;
  easing: string;
  interruption: "cancel-and-settle" | "reverse" | "complete-current";
  mobilePolicy: "allow" | "simplify" | "disable-on-coarse-pointer";
  reducedMotionPolicy: "disable" | "instant" | "simplify";
  blocksPrimaryInteraction: false;
}

export interface MotionDirectorPlan {
  schema: "website-design-compiler/motion-director/v1";
  project: string;
  policy: "PURPOSE_REQUIRED";
  effects: MotionEffectContract[];
}

export function buildMotionDirectorPlan(input: CompilerInput): MotionDirectorPlan {
  return {
    schema: "website-design-compiler/motion-director/v1",
    project: input.project,
    policy: "PURPOSE_REQUIRED",
    effects: [
      {
        id: "hero-reveal",
        engine: "motion",
        target: "[data-motion-id='hero-reveal']",
        purpose: "hierarchy",
        trigger: "mount",
        durationMs: 220,
        easing: "ease-out",
        interruption: "cancel-and-settle",
        mobilePolicy: "simplify",
        reducedMotionPolicy: "instant",
        blocksPrimaryInteraction: false
      },
      {
        id: "evidence-timeline",
        engine: "gsap",
        target: "[data-motion-id='evidence-timeline']",
        purpose: "spatial-continuity",
        trigger: "mount",
        durationMs: 420,
        easing: "power2.out",
        interruption: "cancel-and-settle",
        mobilePolicy: "disable-on-coarse-pointer",
        reducedMotionPolicy: "disable",
        blocksPrimaryInteraction: false
      }
    ]
  };
}

export async function writeMotionDirectorPlan(input: CompilerInput, outputDirectory: string): Promise<string> {
  const directory = join(outputDirectory, "motion-director");
  await mkdir(directory, { recursive: true });
  const plan = buildMotionDirectorPlan(input);
  await validateAgainstSchema<MotionDirectorPlan>(plan, "motion-director.schema.json");
  const path = join(directory, "motion-plan.json");
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}
