import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exportFrontendPlan, importFrontendPlan, validateAuthoringData, type AuthoringData, type FrontendPlanLike } from "../src/puck-authoring.js";

const root = process.cwd();
const frontendPlanPath = join(root, "apps", "site", "generated", "showcase-frontend-plan.json");
const authoringDataPath = join(root, "apps", "site", "generated", "showcase-authoring-data.json");
const outputDirectory = join(root, "artifacts", "authoring");
const outputPath = join(outputDirectory, "authoring-receipt.json");

const frontendPlan = JSON.parse(await readFile(frontendPlanPath, "utf8")) as FrontendPlanLike;
const authoringData = JSON.parse(await readFile(authoringDataPath, "utf8")) as AuthoringData;
const imported = importFrontendPlan(frontendPlan);
const validation = validateAuthoringData(authoringData);
const exported = validation.overall === "PASS" ? exportFrontendPlan(authoringData, frontendPlan.project) : null;
const importedExport = exportFrontendPlan(imported, frontendPlan.project);
const projectionMatches = exported !== null && JSON.stringify(exported) === JSON.stringify(frontendPlan);
const compilerImportRoundTrip = JSON.stringify(importedExport) === JSON.stringify(frontendPlan);

const receipt = {
  schema: "website-design-compiler/authoring-receipt/v1",
  overall: validation.overall === "PASS" && projectionMatches && compilerImportRoundTrip ? "PASS" : "FAIL",
  git: { sha: process.env.GITHUB_SHA ?? "UNBOUND", ref: process.env.GITHUB_REF ?? "UNBOUND" },
  library: { name: "@puckeditor/core", version: "0.22.4" },
  source: { frontendPlan: "apps/site/generated/showcase-frontend-plan.json", authoringData: "apps/site/generated/showcase-authoring-data.json" },
  ownership: {
    schemaOwner: "src/puck-authoring.ts",
    componentRegistry: ["ButtonBlock", "StatusPanelBlock", "Section"],
    productionComponents: ["Button", "StatusPanel"],
    arbitraryHtml: "FORBIDDEN",
    arbitraryCssProps: "FORBIDDEN",
    rawDesignValues: "FORBIDDEN"
  },
  composition: {
    deprecatedDropZoneUsed: false,
    slotFieldUsed: true,
    sectionAllow: ["ButtonBlock", "StatusPanelBlock"],
    recursiveSection: "FORBIDDEN"
  },
  routes: { editor: "/studio", renderer: "/studio/render", invalidFixture: "/studio/render?fixture=invalid" },
  validation,
  projectionMatchesCompilerFrontendPlan: projectionMatches,
  compilerImportRoundTrip,
  publishedPersistence: "LOCAL_STORAGE_FIXTURE_ONLY",
  cmsPersistence: "NOT_IMPLEMENTED"
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath: outputPath, overall: receipt.overall, projectionMatches, compilerImportRoundTrip }));
if (receipt.overall !== "PASS") process.exitCode = 1;
