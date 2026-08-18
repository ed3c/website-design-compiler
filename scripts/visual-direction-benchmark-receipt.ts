import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArenaMatrix } from "../src/arena.js";
import type { CompilerInput } from "../src/contracts.js";
import { buildDesignSystemPlan } from "../src/design-system-compiler.js";
import { OBSERVED_VISUAL_FIXTURE_HTML } from "../src/reference-browser-observation-fixture.js";
import { loadVerifiedVisualReferences, searchVisualDirections } from "../src/visual-direction-search.js";
import { validateAgainstSchema } from "../src/validate.js";

const matrix = JSON.parse(await readFile(resolve("fixtures/arena/benchmark-matrix.json"), "utf8")) as ArenaMatrix;
const outputDirectory = resolve("artifacts/v2/visual-direction-search");
const arenaDirectory = resolve("artifacts/arena");
await mkdir(outputDirectory, { recursive: true });
await mkdir(arenaDirectory, { recursive: true });
const observedReceiptPath = resolve("artifacts/reference-browser/observed-visual-fingerprint.json");
const observedReceiptSha256 = createHash("sha256").update(await readFile(observedReceiptPath)).digest("hex");
const categories = [];
for (const benchmark of matrix.categories) {
  const input: CompilerInput = {
    schema: "website-design-compiler/input/v1",
    project: `visual-${benchmark.id}`,
    brief: { pageType: benchmark.pageType, audience: benchmark.audience, objective: benchmark.objective },
    references: [{
      kind: "html",
      value: OBSERVED_VISUAL_FIXTURE_HTML,
      visualEvidence: {
        receiptPath: "artifacts/reference-browser/observed-visual-fingerprint.json",
        receiptSha256: observedReceiptSha256
      }
    }],
    requestedStages: [...matrix.requiredCompilerStages]
  };
  const verifiedVisualReferences = await loadVerifiedVisualReferences(input);
  const search = searchVisualDirections(input, "website-design-compiler/v2", verifiedVisualReferences);
  await validateAgainstSchema(search, "visual-direction-search-v2.schema.json");
  const designSystem = buildDesignSystemPlan(input, search);
  await validateAgainstSchema(designSystem, "design-system-plan.schema.json");
  const uniqueSignatures = new Set(search.candidates.map((candidate) => candidate.signature)).size;
  const selectedCount = search.candidates.filter((candidate) => candidate.state === "SELECTED").length;
  const rejectedHaveReasons = search.candidates.filter((candidate) => candidate.state === "REJECTED").every((candidate) => candidate.rejectionReasons.length > 0);
  const downstreamWinnerMatch = designSystem.selectedVisualDirection.candidateId === search.selectedCandidateId && JSON.stringify(designSystem.selectedVisualDirection.dimensions) === JSON.stringify(search.selectedDirection);
  const deterministic = JSON.stringify(search) === JSON.stringify(searchVisualDirections(input, "website-design-compiler/v2", verifiedVisualReferences));
  const seededDeterministic = JSON.stringify(searchVisualDirections(input, "arena-v2", verifiedVisualReferences)) === JSON.stringify(searchVisualDirections(input, "arena-v2", verifiedVisualReferences));
  const selected = search.candidates.find((candidate) => candidate.id === search.selectedCandidateId)!;
  const state = search.candidateCount >= 3 && uniqueSignatures >= 3 && search.diversity.state === "PASS" && selectedCount === 1 && rejectedHaveReasons && downstreamWinnerMatch && deterministic && seededDeterministic ? "PASS" : "FAIL";
  categories.push({
    id: benchmark.id,
    state,
    candidateCount: search.candidateCount,
    uniqueSignatures,
    selectedCandidateId: search.selectedCandidateId,
    selectedSignature: selected.signature,
    selectedTotalScore: selected.score.total,
    selectedBriefFit: selected.score.briefFit,
    selectedDifferentiation: selected.score.differentiation,
    selectedReadability: selected.score.readability,
    selectedOriginalityDistance: selected.score.originalityDistance,
    originalityState: search.originality.state,
    observedReferenceCount: search.originality.observedReferenceCount,
    minimumPairwiseDistance: search.diversity.minimumPairwiseDistance,
    selectedResponsiveRobustness: selected.score.responsiveRobustness,
    rejectedHaveReasons,
    downstreamWinnerMatch,
    deterministic,
    seededDeterministic
  });
  await writeFile(resolve(outputDirectory, `${benchmark.id}.json`), `${JSON.stringify(search, null, 2)}\n`, "utf8");
}
const winnerDiversity = new Set(categories.map((category) => category.selectedSignature)).size;
const overall = categories.length === 6 && winnerDiversity >= 3 && categories.every((category) => category.state === "PASS" && category.originalityState === "PASS") ? "PASS" : "FAIL";
const receipt = {
  schema: "website-design-compiler/visual-direction-benchmark-receipt/v2",
  overall,
  categoryCount: categories.length,
  winnerDiversity,
  categories
};
await writeFile(resolve(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
await writeFile(resolve(arenaDirectory, "visual-direction-metrics.json"), `${JSON.stringify({ ...receipt, schema: "website-design-compiler/arena-visual-direction-metrics/v2" }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ overall, categoryCount: categories.length, winnerDiversity }));
if (overall !== "PASS") process.exitCode = 1;
