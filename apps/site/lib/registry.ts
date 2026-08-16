import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";

export const COMPONENT_REGISTRY = {
  button: Button,
  "status-panel": StatusPanel
} as const;

export type RegistryComponentName = keyof typeof COMPONENT_REGISTRY;
export type RegistryComponent = (typeof COMPONENT_REGISTRY)[RegistryComponentName];

export function resolveRegistryComponent(name: RegistryComponentName): RegistryComponent {
  return COMPONENT_REGISTRY[name];
}
