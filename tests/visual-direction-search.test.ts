import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CompilerInput } from "../src/contracts.js";
import { buildDesignSystemPlan } from "../src/design-system-compiler.js";
import { validateAgainstSchema } from "../src/validate.js";
import { auditCandidateOriginality, deriveObservedVisualDimensions, loadVerifiedVisualReferences, searchVisualDirections } from "../src/visual-direction-search.js";

function input(pageType = "product-landing"): CompilerInput {
  return {
    schema: "website-design-compiler/input/v1",
    project: `visual-${pageType}`,
    brief: { pageType, audience: "design teams", objective: "communicate a governed product with a clear primary action" },
    requestedStages: ["visual-direction-search", "design-system-compiler"]
  };
}

test("search produces at least three materially different candidate directions and one winner", () => {
  const receipt = searchVisualDirections(input());
  assert.equal(receipt.candidateCount, 3);
  assert.equal(receipt.candidates.filter((candidate) => candidate.state === "SELECTED").length, 1);
  assert.equal(new Set(receipt.candidates.map((candidate) => candidate.signature)).size, 3);
  assert.equal(new Set(receipt.candidates.map((candidate) => candidate.dimensions.grid)).size >= 2, true);
  assert.equal(new Set(receipt.candidates.map((candidate) => candidate.dimensions.typography)).size >= 2, true);
  assert.equal(receipt.diversity.state, "PASS");
  assert.ok(receipt.diversity.minimumPairwiseDistance >= receipt.diversity.threshold);
  assert.equal(receipt.originality.state, "NOT_EXERCISED");
  assert.equal(receipt.originality.observedReferenceCount, 0);
});

test("every candidate carries auditable score dimensions and rejection reasons", () => {
  const receipt = searchVisualDirections(input("premium-consumer"));
  for (const candidate of receipt.candidates) {
    assert.ok(candidate.score.briefFit >= 0);
    assert.ok(candidate.score.differentiation >= 0);
    assert.ok(candidate.score.readability >= 0);
    assert.ok(candidate.score.responsiveRobustness >= 0);
    assert.equal(candidate.score.originalityDistance, null);
    assert.equal(Number.isInteger(candidate.score.total), true);
    assert.ok(candidate.score.total >= 0 && candidate.score.total <= 100);
    if (candidate.state === "REJECTED") assert.ok(candidate.rejectionReasons.length > 0);
  }
});

test("category fit cannot push a showcase candidate beyond the receipt score contract", async () => {
  const compilerInput: CompilerInput = {
    schema: "website-design-compiler/input/v1",
    project: "evidence-first-showcase",
    brief: {
      pageType: "product-landing",
      audience: "design engineering teams evaluating governed agentic website delivery",
      objective: "show a complete evidence-first path from neutral reference grammar through governed UI, optional motion and graphics, and release receipts"
    },
    requestedStages: ["visual-direction-search"]
  };
  const receipt = searchVisualDirections(compilerInput);
  await validateAgainstSchema(receipt, "visual-direction-search-v2.schema.json");
  assert.ok(receipt.candidates.every((candidate) => candidate.score.total <= 100));
});

test("originality audit rejects a candidate that is too close to an observed reference", () => {
  const receipt = searchVisualDirections(input("editorial-feature"));
  const candidate = receipt.candidates[0]!;
  const reasons = auditCandidateOriginality(candidate, [candidate.dimensions]);
  assert.ok(reasons.some((reason) => reason.includes("too close to an observed reference")));
});

async function withVisualEvidence<T>(sourceHashOverride: string | null, run: (compilerInput: CompilerInput, root: string) => Promise<T>, includeSelfSignedProducer = false): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "wdc-visual-evidence-"));
  try {
    const compilerInput = input("premium-consumer");
    const value = "<!doctype html><main><h1>Observed reference</h1></main>";
    const evidenceBytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(evidenceBytes);
    evidenceBytes.writeUInt32BE(13, 8);
    evidenceBytes.write("IHDR", 12, "ascii");
    evidenceBytes.writeUInt32BE(1280, 16);
    evidenceBytes.writeUInt32BE(800, 20);
    await writeFile(join(root, "evidence.png"), evidenceBytes);
    const digest = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");
    const measurements = {
      desktop: { fontFamily: "Arial", headingFontSizePx: 40, bodyFontSizePx: 16, gridColumnCount: 2, gapPx: 24, cardBorderWidthPx: 1, cardBackgroundColor: "rgba(0, 0, 0, 0)", bodyColor: "rgb(0, 0, 0)", bodyBackgroundColor: "rgba(0, 0, 0, 0)", linkColor: "rgb(0, 0, 238)", images: 1, videos: 0, canvases: 0, transitionDurationMs: 200, transitionProperty: "transform", interactiveControlCount: 0, revealTargetCount: 1 },
      mobile: { fontFamily: "Arial", headingFontSizePx: 30, bodyFontSizePx: 16, gridColumnCount: 1, gapPx: 16, cardBorderWidthPx: 1, cardBackgroundColor: "rgba(0, 0, 0, 0)", bodyColor: "rgb(0, 0, 0)", bodyBackgroundColor: "rgba(0, 0, 0, 0)", linkColor: "rgb(0, 0, 238)", images: 1, videos: 0, canvases: 0, transitionDurationMs: 200, transitionProperty: "transform", interactiveControlCount: 0, revealTargetCount: 1 }
    };
    const receipt = {
      schema: "website-design-compiler/observed-visual-fingerprint/v3",
      state: "PASS",
      producer: "playwright-computed-style/v1",
      referenceValueSha256: sourceHashOverride ?? digest(value),
      capturedArtifactSha256: digest(value),
      producerReceipt: {
        schema: "website-design-compiler/reference-browser-receipt/v2",
        path: "forged-browser-runtime-receipt.json",
        sha256: "0".repeat(64)
      },
      evidenceArtifacts: [
        { viewport: "desktop", path: "evidence.png", sha256: digest(evidenceBytes), width: 1280, minimumHeight: 800 },
        { viewport: "mobile", path: "evidence.png", sha256: digest(evidenceBytes), width: 390, minimumHeight: 844 }
      ],
      measurements,
      dimensions: deriveObservedVisualDimensions(measurements),
      observations: ["computed typography", "computed layout", "computed spacing", "computed motion", "observed media"]
    };
    if (includeSelfSignedProducer) {
      const snapshot = (width: number, height: number, columns: number, headingSize: string) => ({
        viewport: { width, height },
        main: { x: 0, y: 0, width, height },
        hierarchy: { h1: 1, h2: 0, nav: 1, main: 1, section: 1, article: 2 },
        typography: { fontFamily: "Arial", fontSize: headingSize, fontWeight: "700", lineHeight: headingSize },
        layout: { gridColumnCount: columns, gridTemplateColumns: columns === 2 ? "1fr 1fr" : "1fr", gap: "16px" },
        motion: { transitionDuration: "0.2s", transitionProperty: "transform" },
        assets: { images: 1, videos: 0, canvases: 0 }
      });
      const producerReceipt = {
        schema: "website-design-compiler/reference-browser-receipt/v2",
        overall: "PASS",
        execution: { mode: "PLAYWRIGHT_BROWSER", startedAt: "2026-08-18T00:00:00.000Z", completedAt: "2026-08-18T00:00:01.000Z" },
        browser: { engine: "chromium", version: "forged" },
        sourceMode: "DETERMINISTIC_HTML_FIXTURE",
        capturedArtifactSha256: digest(value),
        measurementsSha256: digest(JSON.stringify(measurements)),
        evidenceArtifacts: receipt.evidenceArtifacts,
        observations: { desktop: snapshot(1280, 800, 2, "40px"), mobile: snapshot(390, 844, 1, "30px") },
        responsiveBehavior: { state: "PASS", desktopColumns: 2, mobileColumns: 1, desktopHeadingSize: "40px", mobileHeadingSize: "30px" },
        supportedFacts: ["layout", "typography", "hierarchy", "motion", "assets", "responsive"],
        cameraObservation: "NOT_APPLICABLE",
        implementationDetails: "UNKNOWN"
      };
      const producerReceiptText = `${JSON.stringify(producerReceipt, null, 2)}\n`;
      await writeFile(join(root, "forged-browser-runtime-receipt.json"), producerReceiptText, "utf8");
      receipt.producerReceipt.sha256 = digest(producerReceiptText);
    }
    const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
    await writeFile(join(root, "receipt.json"), receiptText, "utf8");
    compilerInput.references = [{
      kind: "html",
      value,
      visualEvidence: { receiptPath: "receipt.json", receiptSha256: digest(receiptText) }
    }];
    return await run(compilerInput, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("caller-authored measurements and fake screenshot bytes cannot promote originality", async () => {
  await assert.rejects(
    withVisualEvidence(null, async (compilerInput, root) => loadVerifiedVisualReferences(compilerInput, root), true),
    /trusted browser runtime admission/
  );
});

test("an externally admitted receipt still cannot promote an incomplete PNG header", async () => {
  await withVisualEvidence(null, async (compilerInput, root) => {
    const fingerprint = JSON.parse(await readFile(join(root, "receipt.json"), "utf8"));
    const previous = process.env.WDC_REFERENCE_BROWSER_RECEIPT_SHA256;
    process.env.WDC_REFERENCE_BROWSER_RECEIPT_SHA256 = fingerprint.producerReceipt.sha256;
    try {
      await assert.rejects(loadVerifiedVisualReferences(compilerInput, root), /truncated PNG chunk|complete PNG browser screenshot/);
    } finally {
      if (previous === undefined) delete process.env.WDC_REFERENCE_BROWSER_RECEIPT_SHA256;
      else process.env.WDC_REFERENCE_BROWSER_RECEIPT_SHA256 = previous;
    }
  }, true);
});

test("observed fingerprint dimensions are derived from browser measurements", async () => {
  await withVisualEvidence(null, async (compilerInput, root) => {
    const receiptPath = join(root, "receipt.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.dimensions.signatureInteraction = "none";
    const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
    await writeFile(receiptPath, receiptText, "utf8");
    compilerInput.references![0]!.visualEvidence!.receiptSha256 = createHash("sha256").update(receiptText).digest("hex");
    await assert.rejects(loadVerifiedVisualReferences(compilerInput, root), /dimensions do not match browser measurements/);
  });
});

test("measurement derivation does not invent progressive reveal", () => {
  const measurements = {
    desktop: { fontFamily: "Arial", headingFontSizePx: 40, bodyFontSizePx: 16, gridColumnCount: 2, gapPx: 24, cardBorderWidthPx: 0, cardBackgroundColor: "rgba(0, 0, 0, 0)", bodyColor: "rgb(0, 0, 0)", bodyBackgroundColor: "rgba(0, 0, 0, 0)", linkColor: "rgb(0, 0, 238)", images: 1, videos: 0, canvases: 0, transitionDurationMs: 200, transitionProperty: "transform", interactiveControlCount: 0, revealTargetCount: 0 },
    mobile: { fontFamily: "Arial", headingFontSizePx: 30, bodyFontSizePx: 16, gridColumnCount: 1, gapPx: 16, cardBorderWidthPx: 0, cardBackgroundColor: "rgba(0, 0, 0, 0)", bodyColor: "rgb(0, 0, 0)", bodyBackgroundColor: "rgba(0, 0, 0, 0)", linkColor: "rgb(0, 0, 238)", images: 1, videos: 0, canvases: 0, transitionDurationMs: 200, transitionProperty: "transform", interactiveControlCount: 0, revealTargetCount: 0 }
  };
  assert.equal(deriveObservedVisualDimensions(measurements).signatureInteraction, "none");
  assert.equal(deriveObservedVisualDimensions(measurements).surface, "flat");
  assert.equal(deriveObservedVisualDimensions(measurements).typography, "neo-grotesk");
});

test("an observed fingerprint with the wrong source hash fails closed", async () => {
  await assert.rejects(
    withVisualEvidence("0".repeat(64), async (compilerInput, root) => loadVerifiedVisualReferences(compilerInput, root)),
    /not bound to the supplied reference value/
  );
});

test("same input and seed produces identical ranking and winner", () => {
  const first = searchVisualDirections(input("interactive-3d"), "stable-seed");
  const second = searchVisualDirections(input("interactive-3d"), "stable-seed");
  assert.deepEqual(first, second);
});

test("benchmark page families select at least three materially different winners", () => {
  const pageTypes = ["b2b-product", "editorial", "premium-consumer-brand", "motion-heavy-creative", "interactive-2d", "interactive-3d"];
  const observedReference = {
    dimensions: {
      typography: "neo-grotesk", typeContrast: "dramatic", density: "airy", grid: "modular", surface: "bordered",
      colorStrategy: "neutral-accent", mediaStrategy: "product-media", motionIntensity: "moderate", signatureInteraction: "none"
    } as const,
    receiptSha256: "a".repeat(64),
    capturedArtifactSha256: "b".repeat(64),
    evidenceArtifactSha256: "c".repeat(64)
  };
  const winners = pageTypes.map((pageType) => searchVisualDirections(input(pageType), "website-design-compiler/v2", [observedReference]).candidates[0]!.signature);
  assert.ok(new Set(winners).size >= 3, JSON.stringify(winners));
});

test("winner becomes the single downstream selected visual direction", () => {
  const compilerInput = input("motion-heavy-creative");
  const search = searchVisualDirections(compilerInput);
  const designSystem = buildDesignSystemPlan(compilerInput, search);
  assert.equal(designSystem.selectedVisualDirection.candidateId, search.selectedCandidateId);
  assert.deepEqual(designSystem.selectedVisualDirection.dimensions, search.selectedDirection);
  assert.equal(designSystem.selectedVisualDirection.source, search.schema);
});

test("design-system schema admits every canonical governed frontend component", async () => {
  const compilerInput = input("b2b-product");
  const designSystem = buildDesignSystemPlan(compilerInput, searchVisualDirections(compilerInput));

  assert.ok(designSystem.governedComponents.includes("rich-section"));
  await validateAgainstSchema(designSystem, "design-system-plan.schema.json");
});

test("design system consumes the supplied search receipt instead of rerunning search", () => {
  const compilerInput = input("product-landing");
  const search = searchVisualDirections(compilerInput, "downstream-selected-seed");
  const designSystem = buildDesignSystemPlan(compilerInput, search);

  assert.equal(designSystem.selectedVisualDirection.searchSeed, "downstream-selected-seed");
  assert.equal(designSystem.selectedVisualDirection.candidateId, search.selectedCandidateId);
  assert.deepEqual(designSystem.selectedVisualDirection.dimensions, search.selectedDirection);
});
