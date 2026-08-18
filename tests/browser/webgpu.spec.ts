import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type RendererReceipt = {
  state: "WEBGPU_PASS" | "WEBGL_FALLBACK" | "STATIC_FALLBACK" | "NOT_EXERCISED";
  renderer: "webgpu" | "webgl" | "static" | "none";
  reason: string;
  capabilities: { webgpu: boolean; webgl: boolean };
  runtime: null | {
    state: "WEBGPU_PASS";
    identity: {
      adapter: string;
      renderer: string;
      rendererVersion: string;
      tslModule: string;
      features: string[];
      limits: Record<string, number | null>;
    };
    budget: {
      dpr: number;
      drawCalls: number;
      triangles: number;
      textureBytes: number;
      framesRendered: number;
      frameLoop: string;
    };
  };
};

async function readReceipt(page: Page): Promise<RendererReceipt> {
  return page.evaluate(() => (
    window as typeof window & { __wdcGraphics3DReceipt?: RendererReceipt }
  ).__wdcGraphics3DReceipt as RendererReceipt);
}

test("WebGPU opt-in records real execution or explicit NOT_EXERCISED fallback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "one exact WebGPU-capable lane owns this evidence");

  const response = await page.goto("/?graphics3d=webgpu", { waitUntil: "networkidle" });
  expect(response?.ok()).toBeTruthy();
  const graphics3d = page.locator("[data-graphics3d-state]");
  await expect(graphics3d).toHaveAttribute(
    "data-graphics3d-render-state",
    /WEBGPU_PASS|WEBGL_FALLBACK|STATIC_FALLBACK/,
    { timeout: 20_000 }
  );
  await expect(page.locator("[data-graphics3d-semantic-fallback='true']")).toBeVisible();
  await expect(page.getByRole("button").first()).toBeEnabled();

  const selected = await readReceipt(page);
  const observed = selected.state === "WEBGPU_PASS";
  if (observed) {
    expect(selected.runtime?.identity).toMatchObject({
      adapter: "navigator.gpu",
      renderer: "three.WebGPURenderer",
      rendererVersion: "0.184.0",
      tslModule: "three/tsl@0.184.0"
    });
    expect(selected.runtime?.budget).toMatchObject({
      frameLoop: "demand",
      framesRendered: 1,
      textureBytes: expect.any(Number)
    });
    expect(selected.runtime?.budget.textureBytes ?? Infinity).toBeLessThanOrEqual(16_777_216);
    expect(selected.runtime?.budget.drawCalls ?? Infinity).toBeLessThanOrEqual(8);
    expect(selected.runtime?.budget.triangles ?? Infinity).toBeLessThanOrEqual(2500);
    await expect(page.locator("[data-webgpu-canvas='true']")).toHaveCount(1);

    await page.evaluate(() => window.dispatchEvent(new Event("wdc:graphics3d:webgpu-device-loss")));
    const expectedDeviceLossFallback = selected.capabilities.webgl ? "WEBGL_FALLBACK" : "STATIC_FALLBACK";
    await expect(graphics3d).toHaveAttribute("data-graphics3d-render-state", expectedDeviceLossFallback, { timeout: 15_000 });
    await expect(graphics3d).toHaveAttribute("data-graphics3d-disposed", "true");
    if (selected.capabilities.webgl) {
      await expect(page.locator("[data-r3f-canvas='true']")).toHaveCount(1, { timeout: 15_000 });
    } else {
      await expect(page.locator("[data-graphics3d-static-poster='true']")).toBeVisible();
    }
  } else {
    expect(selected.state).toMatch(/WEBGL_FALLBACK|STATIC_FALLBACK/);
    await expect(page.locator("[data-webgpu-canvas='true']")).toHaveCount(0);
  }

  const forcedFailureResponse = await page.goto("/?graphics3d=webgpu&graphics3dFailure=webgpu-init", { waitUntil: "networkidle" });
  expect(forcedFailureResponse?.ok()).toBeTruthy();
  await expect(page.locator("[data-graphics3d-state]")).toHaveAttribute(
    "data-graphics3d-render-state",
    /WEBGL_FALLBACK|STATIC_FALLBACK/,
    { timeout: 20_000 }
  );
  await expect(page.getByRole("button").first()).toBeEnabled();
  const forcedInitialization = await readReceipt(page);
  const initializationFailureObserved = selected.capabilities.webgpu &&
    forcedInitialization.reason === "webgpu-initialization-failed:forced-initialization-failure";

  const totalFailureResponse = await page.goto("/?graphics3d=off", { waitUntil: "networkidle" });
  expect(totalFailureResponse?.ok()).toBeTruthy();
  await expect(page.locator("[data-graphics3d-state]")).toHaveAttribute("data-graphics3d-render-state", "STATIC_FALLBACK");
  await expect(page.locator("[data-graphics3d-static-poster='true']")).toBeVisible();
  await expect(page.getByRole("button").first()).toBeEnabled();

  const outputDirectory = join(process.cwd(), "artifacts", "browser-qa", "webgpu");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "desktop-chromium.json"), `${JSON.stringify({
    schema: "website-design-compiler/webgpu-runtime-receipt/v1",
    overall: observed ? "WEBGPU_PASS" : "NOT_EXERCISED",
    selected,
    fallbacks: {
      initializationFailure: initializationFailureObserved ? "PASS" : "NOT_EXERCISED",
      totalGpuFailure: "PASS",
      deviceLoss: observed ? "PASS" : "NOT_EXERCISED"
    }
  }, null, 2)}\n`, "utf8");
});
