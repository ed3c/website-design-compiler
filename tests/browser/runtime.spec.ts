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

  const graphics2d = page.locator("[data-graphics-state]");
  await expect(graphics2d).toHaveAttribute("data-graphics-state", "ready", { timeout: 10_000 });
  await expect(page.locator("[data-pixi-canvas='true']")).toHaveCount(1);
  await expect(page.locator("[data-semantic-fallback='true']")).toHaveCount(1);
  const graphics2dResolution = Number(await graphics2d.getAttribute("data-resolution"));
  expect(graphics2dResolution).toBeGreaterThanOrEqual(1);
  expect(graphics2dResolution).toBeLessThanOrEqual(testInfo.project.name === "mobile-chromium" ? 1.5 : 2);

  const graphics3d = page.locator("[data-graphics3d-state]");
  await expect(graphics3d).toHaveAttribute("data-graphics3d-state", "ready", { timeout: 15_000 });
  await expect(page.locator("[data-r3f-canvas='true']")).toHaveCount(1);
  await expect(page.locator("[data-graphics3d-semantic-fallback='true']")).toHaveCount(1);
  const graphics3dDpr = Number(await graphics3d.getAttribute("data-graphics3d-dpr"));
  expect(graphics3dDpr).toBeGreaterThanOrEqual(1);
  expect(graphics3dDpr).toBeLessThanOrEqual(testInfo.project.name === "mobile-chromium" ? 1.25 : 1.75);

  const screenshotDirectory = join(process.cwd(), "artifacts", "browser-qa", "screenshots");
  await mkdir(screenshotDirectory, { recursive: true });
  const screenshotPath = join(screenshotDirectory, `${testInfo.project.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("full-page", { path: screenshotPath, contentType: "image/png" });

  if (testInfo.project.name === "desktop-chromium") {
    await page.evaluate(() => window.dispatchEvent(new Event("wdc:graphics3d:dispose")));
    await expect(graphics3d).toHaveAttribute("data-graphics3d-disposed", "true");
    await expect(page.locator("[data-r3f-canvas='true']")).toHaveCount(0);
    await expect(page.locator("[data-graphics3d-static-poster='true']")).toHaveCount(1);
    await expect(firstButton).toBeEnabled();

    const fallbackResponse = await page.goto("/?graphics=off&graphics3d=off", { waitUntil: "networkidle" });
    expect(fallbackResponse?.ok()).toBeTruthy();

    const fallback2d = page.locator("[data-graphics-state]");
    await expect(fallback2d).toHaveAttribute("data-graphics-state", "fallback");
    await expect(page.locator("[data-pixi-host='true']")).toHaveAttribute("data-forced-fallback", "true");
    await expect(page.locator("[data-pixi-canvas='true']")).toHaveCount(0);
    await expect(page.locator("[data-static-poster='true']")).toHaveCount(1);
    await expect(page.locator("[data-semantic-fallback='true']")).toHaveCount(1);

    const fallback3d = page.locator("[data-graphics3d-state]");
    await expect(fallback3d).toHaveAttribute("data-graphics3d-state", "fallback");
    await expect(fallback3d).toHaveAttribute("data-graphics3d-enabled", "false");
    await expect(page.locator("[data-r3f-canvas='true']")).toHaveCount(0);
    await expect(page.locator("[data-graphics3d-static-poster='true']")).toHaveCount(1);
    await expect(page.locator("[data-graphics3d-semantic-fallback='true']")).toHaveCount(1);
    await expect(page.getByRole("button").first()).toBeEnabled();
  }

  expect(consoleErrors, `console/page errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(failedRequests, `failed requests: ${failedRequests.join(" | ")}`).toEqual([]);
});
