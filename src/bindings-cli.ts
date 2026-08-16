import { readdir, writeFile } from "node:fs/promises";
import { resolveSharedBindings, readJsonFile, type RegistryProjection, type SharedBindingsFile } from "./bindings.js";

const [, , bindingPath, projectionPath, localSkillsDir, outputPath] = process.argv;

if (!bindingPath || !projectionPath || !outputPath) {
  console.error("usage: tsx src/bindings-cli.ts <bindings.json> <projection.json> [local-skills-dir|-] <output.json>");
  process.exit(2);
}

const bindingFile = await readJsonFile<SharedBindingsFile>(bindingPath);
const projection = await readJsonFile<RegistryProjection>(projectionPath);
let localSkillNames: string[] = [];

if (localSkillsDir && localSkillsDir !== "-") {
  localSkillNames = await readdir(localSkillsDir, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
    .catch(() => []);
}

const receipt = resolveSharedBindings(bindingFile, projection, localSkillNames);
await writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");

if (receipt.overall !== "PASS") {
  process.exitCode = 1;
}
