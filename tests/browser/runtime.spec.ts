import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test("core runtime is keyboard reachable, motion-bounded, graphics-degradable, console clean, network clean, and screenshotable", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`);
  });

  if (testInfo.project.name === "reduced-motion-chromium") {
    await page.emulateMedia({ reducedMotion: "reduce" });
  }

  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Compile design intent");

  await page.keyboard.press("Tab");
  const firstButton = page.getByRole("button").first();
  await expect(firstButton).toBeFocused();

  const motionEffect = page.locator("[data-motion-engine='motion']");
  const gsapEffect = page.locator("[data-motion-engine='gsap']");
  await expect(motionEffect).toHaveCount(1);
  await expect(gsapEffect).toHaveCount(1);
  await expect(gsapEffect).not.toHaveAttribute("data-gsap-active", "pending");
  expect(await page.locator("[data-custom-cursor]").count()).toBe(0);

  if (testInfo.project.name === "reduced-motion-chromium") {
    const reduced = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(reduced).toBe(true);
    await expect(motionEffect).toHaveAttribute("data-reduced-motion", "true");
    await expect(gsapEffect).toHaveAttribute("data-reduced-motion", "true");
    await expect(gsapEffect).toHaveAttribute("data-gsap-active", "false");
  } else if (testInfo.project.name === "mobile-chromium") {
    await expect(gsapEffect).toHaveAttribute("data-coarse-pointer", "true");
    await expect(gsapEffect).toHaveAttribute("data-gsap-active", "false");
  } else {
    await expect(motionEffect).toHaveAttribute("data-reduced-motion", "false");
    await expect(gsapEffect).toHaveAttribute("data-gsap-active", "true");
  }

  const graphics = page.locator("[data-graphics-state]");
  await expect(graphics).toHaveAttribute("data-graphics-state", "ready", { timeout: 10_000 });
  await expect(page.locator("[data-pixi-canvas='true']")).toHaveCount(1);
  await expect(page.locator("[data-semantic-fallback='true']")).toHaveCount(1);
  const graphicsResolution = Number(await graphics.getAttribute("data-resolution"));
  expect(graphicsResolution).toBeGreaterThanOrEqual(1);
  expect(graphicsResolution).toBeLessThanOrEqual(testInfo.project.name === "mobile-chromium" ? 1.5 : 2);

  const screenshotDirectory = join(process.cwd(), "artifacts", "browser-qa", "screenshots");
  await mkdir(screenshotDirectory, { recursive: true });
  const screenshotPath = join(screenshotDirectory, `${testInfo.project.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("full-page", { path: screenshotPath, contentType: "image/png" });

  if (testInfo.project.name === "desktop-chromium") {
    const fallbackResponse = await page.goto("/?graphics=off", { waitUntil: "networkidle" });
    expect(fallbackResponse?.ok()).toBeTruthy();
    const fallbackGraphics = page.locator("[data-graphics-state]");
    await expect(fallbackGraphics).toHaveAttribute("data-graphics-state", "fallback");
    await expect(page.locator("[data-pixi-host='true']")).toHaveAttribute("data-forced-fallback", "true");
    await expect(page.locator("[data-pixi-canvas='true']")).toHaveCount(0);
    await expect(page.locator("[data-static-poster='true']")).toHaveCount(1);
    await expect(page.locator("[data-semantic-fallback='true']")).toHaveCount(1);
  }

  expect(consoleErrors, `console/page errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(failedRequests, `failed requests: ${failedRequests.join(" | ")}`).toEqual([]);
});
