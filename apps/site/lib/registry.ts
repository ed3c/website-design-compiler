import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";

export const COMPONENT_REGISTRY = {
  button: Button,
  "status-panel": StatusPanel
} satisfies Record<string, ComponentType<any>>;

export type RegistryComponentName = keyof typeof COMPONENT_REGISTRY;

export function resolveRegistryComponent(name: RegistryComponentName) {
  return COMPONENT_REGISTRY[name];
}
