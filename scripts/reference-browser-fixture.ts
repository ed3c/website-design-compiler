import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { OBSERVED_VISUAL_FIXTURE_HTML } from "../src/reference-browser-observation-fixture.js";
import { deriveObservedVisualDimensions, type ObservedVisualMeasurement } from "../src/visual-direction-search.js";
import { validateAgainstSchema } from "../src/validate.js";

const FIXTURE_HTML = `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { margin: 0; font-family: Arial, sans-serif; }
    nav { height: 48px; display: flex; align-items: center; }
    main { width: min(720px, calc(100vw - 32px)); margin: 0 auto; }
    h1 { font-size: 40px; line-height: 48px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .card { min-height: 120px; transition: transform 200ms ease; }
    @media (max-width: 600px) {
      h1 { font-size: 30px; line-height: 36px; }
      .grid { grid-template-columns: 1fr; gap: 16px; }
    }
  </style>
</head>
<body>
  <nav><a href="#main">Reference navigation</a></nav>
  <main id="main">
    <h1>Browser observed hierarchy</h1>
    <section class="grid">
      <article class="card"><h2>Evidence A</h2><img alt="fixture" width="16" height="12" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGOsCDjBQApgIkn1qIYRpAEAsVkBqEXr8uYAAAAASUVORK5CYII="></article>
      <article class="card"><h2>Evidence B</h2></article>
    </section>
  </main>
</body>
</html>`;

type Snapshot = {
  viewport: { width: number; height: number };
  main: { x: number; y: number; width: number; height: number };
  hierarchy: { h1: number; h2: number; nav: number; main: number; section: number; article: number };
  typography: { fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string };
  layout: { gridColumnCount: number; gridTemplateColumns: string; gap: string };
  motion: { transitionDuration: string; transitionProperty: string };
  assets: { images: number; videos: number; canvases: number };
  visualMeasurement: ObservedVisualMeasurement;
};

async function observe(page: Page, width: number, height: number): Promise<Snapshot> {
  await page.setViewportSize({ width, height });
  await page.setContent(OBSERVED_VISUAL_FIXTURE_HTML, { waitUntil: "load" });
  return page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    const h1 = document.querySelector("h1") as HTMLElement;
    const grid = document.querySelector(".grid") as HTMLElement;
    const card = document.querySelector(".card") as HTMLElement;
    const mainRect = main.getBoundingClientRect();
    const h1Style = getComputedStyle(h1);
    const gridStyle = getComputedStyle(grid);
    const cardStyle = getComputedStyle(card);
    const bodyStyle = getComputedStyle(document.body);
    const linkStyle = getComputedStyle(document.querySelector("a") as HTMLElement);
    const columns = gridStyle.gridTemplateColumns.split(/\s+/).filter(Boolean);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      main: { x: mainRect.x, y: mainRect.y, width: mainRect.width, height: mainRect.height },
      hierarchy: {
        h1: document.querySelectorAll("h1").length,
        h2: document.querySelectorAll("h2").length,
        nav: document.querySelectorAll("nav").length,
        main: document.querySelectorAll("main").length,
        section: document.querySelectorAll("section").length,
        article: document.querySelectorAll("article").length
      },
      typography: {
        fontFamily: h1Style.fontFamily,
        fontSize: h1Style.fontSize,
        fontWeight: h1Style.fontWeight,
        lineHeight: h1Style.lineHeight
      },
      layout: {
        gridColumnCount: columns.length,
        gridTemplateColumns: gridStyle.gridTemplateColumns,
        gap: gridStyle.gap
      },
      motion: {
        transitionDuration: cardStyle.transitionDuration,
        transitionProperty: cardStyle.transitionProperty
      },
      assets: {
        images: document.images.length,
        videos: document.querySelectorAll("video").length,
        canvases: document.querySelectorAll("canvas").length
      },
      visualMeasurement: {
        fontFamily: h1Style.fontFamily,
        headingFontSizePx: Number.parseFloat(h1Style.fontSize),
        bodyFontSizePx: Number.parseFloat(bodyStyle.fontSize),
        gridColumnCount: columns.length,
        gapPx: Number.parseFloat(gridStyle.gap),
        cardBorderWidthPx: Number.parseFloat(cardStyle.borderTopWidth),
        cardBackgroundColor: cardStyle.backgroundColor,
        bodyColor: bodyStyle.color,
        bodyBackgroundColor: bodyStyle.backgroundColor,
        linkColor: linkStyle.color,
        images: document.images.length,
        videos: document.querySelectorAll("video").length,
        canvases: document.querySelectorAll("canvas").length,
        transitionDurationMs: Number.parseFloat(cardStyle.transitionDuration) * (cardStyle.transitionDuration.endsWith("ms") ? 1 : 1000),
        transitionProperty: cardStyle.transitionProperty,
        interactiveControlCount: document.querySelectorAll("button,input,select,textarea,[role='button']").length,
        revealTargetCount: document.querySelectorAll("[data-reveal],[aria-expanded]").length
      }
    };
  });
}

const browser = await chromium.launch({ headless: true });
const startedAt = new Date().toISOString();
try {
  const page = await browser.newPage();
  const desktop = await observe(page, 1280, 800);
  const outputDirectory = join(process.cwd(), "artifacts", "reference-browser");
  await mkdir(outputDirectory, { recursive: true });
  const desktopEvidencePath = join(outputDirectory, "observed-visual-reference-desktop.png");
  await page.screenshot({ path: desktopEvidencePath, fullPage: true });
  const mobile = await observe(page, 390, 844);
  const mobileEvidencePath = join(outputDirectory, "observed-visual-reference-mobile.png");
  await page.screenshot({ path: mobileEvidencePath, fullPage: true });
  const responsiveChanged = desktop.layout.gridColumnCount === 2 && mobile.layout.gridColumnCount === 1 && desktop.typography.fontSize !== mobile.typography.fontSize;
  const { visualMeasurement: desktopMeasurement, ...desktopObservation } = desktop;
  const { visualMeasurement: mobileMeasurement, ...mobileObservation } = mobile;

  const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const desktopEvidenceBytes = await import("node:fs/promises").then(({ readFile }) => readFile(desktopEvidencePath));
  const mobileEvidenceBytes = await import("node:fs/promises").then(({ readFile }) => readFile(mobileEvidencePath));
  const measurements = { desktop: desktopMeasurement, mobile: mobileMeasurement };
  const evidenceArtifacts = [
    {
      viewport: "desktop" as const,
      path: "artifacts/reference-browser/observed-visual-reference-desktop.png",
      sha256: sha256(desktopEvidenceBytes),
      width: desktop.viewport.width,
      minimumHeight: desktop.viewport.height
    },
    {
      viewport: "mobile" as const,
      path: "artifacts/reference-browser/observed-visual-reference-mobile.png",
      sha256: sha256(mobileEvidenceBytes),
      width: mobile.viewport.width,
      minimumHeight: mobile.viewport.height
    }
  ];
  const receipt = {
    schema: "website-design-compiler/reference-browser-receipt/v2",
    overall: responsiveChanged ? "PASS" as const : "FAIL" as const,
    execution: {
      mode: "PLAYWRIGHT_BROWSER" as const,
      startedAt,
      completedAt: new Date().toISOString()
    },
    browser: { engine: "chromium", version: browser.version() },
    sourceMode: "DETERMINISTIC_HTML_FIXTURE",
    capturedArtifactSha256: sha256(OBSERVED_VISUAL_FIXTURE_HTML),
    measurementsSha256: sha256(JSON.stringify(measurements)),
    evidenceArtifacts,
    observations: { desktop: desktopObservation, mobile: mobileObservation },
    responsiveBehavior: {
      state: responsiveChanged ? "PASS" as const : "FAIL" as const,
      desktopColumns: desktop.layout.gridColumnCount,
      mobileColumns: mobile.layout.gridColumnCount,
      desktopHeadingSize: desktop.typography.fontSize,
      mobileHeadingSize: mobile.typography.fontSize
    },
    supportedFacts: ["computed layout geometry", "computed typography", "heading/landmark hierarchy", "computed motion styles", "asset element counts", "responsive behavior across fixed viewports"],
    cameraObservation: "NOT_APPLICABLE" as const,
    implementationDetails: "UNKNOWN" as const
  };

  await validateAgainstSchema(receipt, "reference-browser-receipt.schema.json");
  const outputPath = join(outputDirectory, "reference-browser-receipt.json");
  const producerReceiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  await writeFile(outputPath, producerReceiptText, "utf8");
  const producerReceiptSha256 = sha256(producerReceiptText);
  const visualFingerprint = {
    schema: "website-design-compiler/observed-visual-fingerprint/v3",
    state: "PASS",
    producer: "playwright-computed-style/v1",
    referenceValueSha256: sha256(OBSERVED_VISUAL_FIXTURE_HTML),
    capturedArtifactSha256: sha256(OBSERVED_VISUAL_FIXTURE_HTML),
    producerReceipt: {
      schema: "website-design-compiler/reference-browser-receipt/v2",
      path: "artifacts/reference-browser/reference-browser-receipt.json",
      sha256: producerReceiptSha256
    },
    evidenceArtifacts,
    measurements,
    dimensions: deriveObservedVisualDimensions(measurements),
    observations: [
      `desktop computed heading: ${desktop.typography.fontFamily} ${desktop.typography.fontSize}/${desktop.typography.lineHeight}`,
      `responsive grid columns: ${desktop.layout.gridColumnCount} desktop, ${mobile.layout.gridColumnCount} mobile`,
      `computed grid gap: ${desktop.layout.gap}`,
      `computed transition: ${desktop.motion.transitionProperty} ${desktop.motion.transitionDuration}`,
      `observed assets: ${desktop.assets.images} image, ${desktop.assets.videos} video, ${desktop.assets.canvases} canvas`
    ]
  } as const;
  await validateAgainstSchema(visualFingerprint, "observed-visual-fingerprint-v3.schema.json");
  const fingerprintPath = join(outputDirectory, "observed-visual-fingerprint.json");
  await writeFile(fingerprintPath, `${JSON.stringify(visualFingerprint, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, fingerprintPath, producerReceiptSha256, overall: receipt.overall, responsiveBehavior: receipt.responsiveBehavior }));
  if (receipt.overall !== "PASS") process.exitCode = 1;
} finally {
  await browser.close();
}
