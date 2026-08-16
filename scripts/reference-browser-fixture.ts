import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
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
};

async function observe(page: Page, width: number, height: number): Promise<Snapshot> {
  await page.setViewportSize({ width, height });
  await page.setContent(FIXTURE_HTML, { waitUntil: "load" });
  return page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    const h1 = document.querySelector("h1") as HTMLElement;
    const grid = document.querySelector(".grid") as HTMLElement;
    const card = document.querySelector(".card") as HTMLElement;
    const mainRect = main.getBoundingClientRect();
    const h1Style = getComputedStyle(h1);
    const gridStyle = getComputedStyle(grid);
    const cardStyle = getComputedStyle(card);
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
      }
    };
  });
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const desktop = await observe(page, 1280, 800);
  const mobile = await observe(page, 390, 844);
  const responsiveChanged = desktop.layout.gridColumnCount === 2 && mobile.layout.gridColumnCount === 1 && desktop.typography.fontSize !== mobile.typography.fontSize;

  const receipt = {
    schema: "website-design-compiler/reference-browser-receipt/v1",
    overall: responsiveChanged ? "PASS" as const : "FAIL" as const,
    browser: { engine: "chromium", version: browser.version() },
    sourceMode: "DETERMINISTIC_HTML_FIXTURE",
    observations: { desktop, mobile },
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
  const outputDirectory = join(process.cwd(), "artifacts", "reference-browser");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "reference-browser-receipt.json");
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, overall: receipt.overall, responsiveBehavior: receipt.responsiveBehavior }));
  if (receipt.overall !== "PASS") process.exitCode = 1;
} finally {
  await browser.close();
}
