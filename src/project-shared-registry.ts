import { readFile, writeFile } from "node:fs/promises";

interface SharedRegistry {
  schema: string;
  canonical_root: string;
  shared: Array<{ name: string }>;
}

const [, , registryPath, sourceRepository, sourceCommit, outputPath] = process.argv;

if (!registryPath || !sourceRepository || !sourceCommit || !outputPath) {
  console.error(
    "usage: tsx src/project-shared-registry.ts <registry.json> <owner/repo> <commit-sha> <output.json>"
  );
  process.exit(2);
}

const registry = JSON.parse(await readFile(registryPath, "utf8")) as SharedRegistry;
if (registry.schema !== "shared-skills-registry/v2") {
  throw new Error(`unsupported shared registry schema: ${registry.schema}`);
}

const skills = registry.shared
  .map((entry) => entry.name)
  .sort()
  .map((name) => ({
    name,
    identity: `git:${sourceCommit}:${registry.canonical_root}/${name}`
  }));

const projection = {
  schema: "website-design-compiler/shared-registry-projection/v1",
  sourceRepository,
  sourceIdentity: `git:${sourceCommit}`,
  sourceRegistry: {
    path: registryPath,
    schema: registry.schema
  },
  skills
};

await writeFile(outputPath, JSON.stringify(projection, null, 2) + "\n", "utf8");
