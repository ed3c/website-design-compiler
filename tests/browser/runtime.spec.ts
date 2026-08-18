import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  evaluateQualityMeasurements,
  type QualityMeasurements,
  type ReleaseBudgets
} from "../../src/quality-gates.js";

type BrowserPerfStore = { lcp: number; cls: number; inp: number };

test("core runtime satisfies governed browser accessibility performance and degradation gates", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const project = testInfo.project.name;
  const evidenceDirectory = join(process.cwd(), "artifacts", "accessibility-performance");
  await mkdir(evidenceDirectory, { recursive: true });
  const evidencePath = join(evidenceDirectory, `${project}.json`);
  const budgets = JSON.parse(await readFile(join(process.cwd(), "policies", "release-budgets.json"), "utf8")) as ReleaseBudgets;
  const graphics2dPlan = JSON.parse(await readFile(join(process.cwd(), "artifacts", "runtime", "minimal", "graphics-2d", "graphics-2d-plan.json"), "utf8")) as {
    assetBudget: { externalBytes: number };
  };
  const graphics3dPlan = JSON.parse(await readFile(join(process.cwd(), "artifacts", "runtime", "minimal", "graphics-3d", "graphics-3d-plan.json"), "utf8")) as {
    assetBudget: { externalBytes: number; textureBytes: number; maxTriangles: number; maxDrawCalls: number };
  };

  await page.addInitScript(() => {
    const target = window as typeof window & { __wdcPerf?: BrowserPerfStore };
    const store: BrowserPerfStore = { lcp: 0, cls: 0, inp: 0 };
    target.__wdcPerf = store;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) store.lcp = Math.max(store.lcp, entry.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
          if (!shift.hadRecentInput) store.cls += shift.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) store.inp = Math.max(store.inp, entry.duration);
      }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    } catch {}
  });

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`);
  });

  if (project === "reduced-motion-chromium") await page.emulateMedia({ reducedMotion: "reduce" });

  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Compile design intent");

  await page.keyboard.press("Tab");
  const firstButton = page.getByRole("button").first();
  await expect(firstButton).toBeFocused();

  const motionEffect = page.locator("[data-motion-engine='motion']");
  const gsapEffect = page.locator("[data-motion-engine='gsap']");
  await expect(gsapEffect).not.toHaveAttribute("data-gsap-active", "pending");
  expect(await page.locator("[data-custom-cursor]").count()).toBe(0);

  const exercisedDegradationPaths: string[] = [];
  if (project === "reduced-motion-chromium") {
    expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await expect(motionEffect).toHaveAttribute("data-reduced-motion", "true");
    await expect(gsapEffect).toHaveAttribute("data-gsap-active", "false");
    exercisedDegradationPaths.push("prefers-reduced-motion");
  } else if (project === "mobile-chromium") {
    await expect(gsapEffect).toHaveAttribute("data-coarse-pointer", "true");
    await expect(gsapEffect).toHaveAttribute("data-gsap-active", "false");
    exercisedDegradationPaths.push("coarse-pointer");
  } else {
    await expect(motionEffect).toHaveAttribute("data-reduced-motion", "false");
    await expect(gsapEffect).toHaveAttribute("data-gsap-active", "true");
  }

  const graphics2d = page.locator("[data-graphics-state]");
  await expect(graphics2d).toHaveAttribute("data-graphics-state", "ready", { timeout: 10_000 });
  await expect(page.locator("[data-pixi-canvas='true']")).toHaveCount(1);
  const graphics2dResolution = Number(await graphics2d.getAttribute("data-resolution"));
  expect(graphics2dResolution).toBeLessThanOrEqual(project === "mobile-chromium" ? 1.5 : 2);

  const graphics3d = page.locator("[data-graphics3d-state]");
  await expect(graphics3d).toHaveAttribute("data-graphics3d-state", "ready", { timeout: 15_000 });
  await expect(graphics3d).toHaveAttribute("data-graphics3d-render-state", "WEBGL_FALLBACK");
  await expect(graphics3d).toHaveAttribute("data-graphics3d-renderer", "webgl");
  await expect(page.locator("[data-r3f-canvas='true']")).toHaveCount(1);
  const graphics3dDpr = Number(await graphics3d.getAttribute("data-graphics3d-dpr"));
  expect(graphics3dDpr).toBeLessThanOrEqual(project === "mobile-chromium" ? 1.25 : 1.75);
  const graphics3dRendererReceipt = await page.evaluate(() => (
    window as typeof window & { __wdcGraphics3DReceipt?: unknown }
  ).__wdcGraphics3DReceipt);

  await firstButton.click();
  await page.waitForTimeout(150);
  await page.waitForFunction(() => {
    const perf = (window as typeof window & { __wdcPerf?: BrowserPerfStore }).__wdcPerf;
    return (perf?.lcp ?? 0) > 0;
  }, undefined, { timeout: 5000 }).catch(() => {});

  const initialAxe = await new AxeBuilder({ page }).analyze();
  const initialSeriousCritical = initialAxe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").length;
  const mainLandmarks = await page.locator("main").count();
  const h1Count = await page.locator("h1").count();
  const states = await page.locator("[data-state]").evaluateAll((elements) => [...new Set(elements.map((element) => element.getAttribute("data-state") ?? ""))].filter(Boolean));
  const interactiveBoxes = await page.getByRole("button").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return Math.min(rect.width, rect.height);
  }));
  const minTouchTargetPx = interactiveBoxes.length > 0 ? Math.min(...interactiveBoxes) : 0;

  const performanceMetrics = await page.evaluate(() => {
    const perf = (window as typeof window & { __wdcPerf?: BrowserPerfStore }).__wdcPerf ?? { lcp: 0, cls: 0, inp: 0 };
    const navigation = window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const resources = window.performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const transferred = (entry: PerformanceResourceTiming | PerformanceNavigationTiming) => entry.transferSize || entry.encodedBodySize || 0;
    const resourceBytes = resources.reduce((sum, entry) => sum + transferred(entry), 0);
    return {
      lcpMs: perf.lcp,
      cls: perf.cls,
      inpMs: perf.inp > 0 ? perf.inp : null,
      ttfbMs: navigation ? Math.max(0, navigation.responseStart - navigation.requestStart) : Number.POSITIVE_INFINITY,
      totalTransferBytes: resourceBytes + (navigation ? transferred(navigation) : 0),
      scriptTransferBytes: resources.filter((entry) => entry.initiatorType === "script").reduce((sum, entry) => sum + transferred(entry), 0),
      imageTransferBytes: resources.filter((entry) => entry.initiatorType === "img" || entry.initiatorType === "image").reduce((sum, entry) => sum + transferred(entry), 0),
      videoTransferBytes: resources.filter((entry) => entry.initiatorType === "video").reduce((sum, entry) => sum + transferred(entry), 0),
      domNodes: document.getElementsByTagName("*").length
    };
  });

  const screenshotDirectory = join(process.cwd(), "artifacts", "browser-qa", "screenshots");
  await mkdir(screenshotDirectory, { recursive: true });
  const screenshotPath = join(screenshotDirectory, `${project}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("full-page", { path: screenshotPath, contentType: "image/png" });

  let fallbackAxeSeriousCriticalViolations: number | null = null;
  let graphics2dFallbackVerified = project !== "desktop-chromium";
  let graphics3dFallbackVerified = project !== "desktop-chromium";

  if (project === "desktop-chromium") {
    await page.evaluate(() => window.dispatchEvent(new Event("wdc:motion:route-change")));
    await expect(gsapEffect).toHaveAttribute("data-route-cleanup-observed", "true");
    await expect(gsapEffect).toHaveAttribute("data-gsap-active", "false");

    await page.evaluate(() => window.dispatchEvent(new Event("wdc:graphics3d:dispose")));
    await expect(graphics3d).toHaveAttribute("data-graphics3d-disposed", "true");
    await expect(page.locator("[data-r3f-canvas='true']")).toHaveCount(0);

    const fallbackResponse = await page.goto("/?graphics=off&graphics3d=off", { waitUntil: "networkidle" });
    expect(fallbackResponse?.ok()).toBeTruthy();
    await expect(page.locator("[data-graphics-state]")).toHaveAttribute("data-graphics-state", "fallback");
    await expect(page.locator("[data-pixi-canvas='true']")).toHaveCount(0);
    await expect(page.locator("[data-static-poster='true']")).toHaveCount(1);
    await expect(page.locator("[data-graphics3d-state]")).toHaveAttribute("data-graphics3d-state", "fallback");
    await expect(page.locator("[data-graphics3d-state]")).toHaveAttribute("data-graphics3d-render-state", "STATIC_FALLBACK");
    await expect(page.locator("[data-r3f-canvas='true']")).toHaveCount(0);
    await expect(page.locator("[data-graphics3d-static-poster='true']")).toHaveCount(1);
    await expect(page.getByRole("button").first()).toBeEnabled();
    const fallbackAxe = await new AxeBuilder({ page }).analyze();
    fallbackAxeSeriousCriticalViolations = fallbackAxe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").length;
    graphics2dFallbackVerified = true;
    graphics3dFallbackVerified = true;
    exercisedDegradationPaths.push("graphics=off", "graphics3d=off");
  }

  const measurements: QualityMeasurements = {
    axeSeriousCriticalViolations: initialSeriousCritical,
    fallbackAxeSeriousCriticalViolations,
    mainLandmarks,
    h1Count,
    minTouchTargetPx,
    lcpMs: performanceMetrics.lcpMs,
    cls: performanceMetrics.cls,
    ttfbMs: performanceMetrics.ttfbMs,
    inpMs: performanceMetrics.inpMs,
    totalTransferBytes: performanceMetrics.totalTransferBytes,
    scriptTransferBytes: performanceMetrics.scriptTransferBytes,
    imageTransferBytes: performanceMetrics.imageTransferBytes,
    videoTransferBytes: performanceMetrics.videoTransferBytes,
    domNodes: performanceMetrics.domNodes,
    states,
    reducedMotionVerified: project !== "reduced-motion-chromium" || exercisedDegradationPaths.includes("prefers-reduced-motion"),
    coarsePointerVerified: project !== "mobile-chromium" || exercisedDegradationPaths.includes("coarse-pointer"),
    graphics2dFallbackVerified,
    graphics3dFallbackVerified,
    graphics2dExternalAssetBytes: graphics2dPlan.assetBudget.externalBytes,
    graphics3dExternalAssetBytes: graphics3dPlan.assetBudget.externalBytes,
    graphics3dTextureAssetBytes: graphics3dPlan.assetBudget.textureBytes,
    graphics3dMaxTriangles: graphics3dPlan.assetBudget.maxTriangles,
    graphics3dMaxDrawCalls: graphics3dPlan.assetBudget.maxDrawCalls
  };
  const evaluation = evaluateQualityMeasurements(measurements, budgets);
  const evidence = {
    schema: "website-design-compiler/accessibility-performance-project/v1",
    project,
    overall: evaluation.overall,
    configuration: { schema: budgets.schema, version: budgets.version },
    exercisedDegradationPaths,
    graphics3dRendererReceipt,
    measurements,
    gates: evaluation.gates,
    axe: {
      seriousCriticalRuleIds: initialAxe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)
    }
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  expect(evaluation.overall, `quality gates: ${JSON.stringify(evaluation.gates)}`).toBe("PASS");
  expect(consoleErrors, `console/page errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(failedRequests, `failed requests: ${failedRequests.join(" | ")}`).toEqual([]);
});
