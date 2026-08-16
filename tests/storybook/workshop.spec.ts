import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const stories = [
  { id: "governed-ui-button--primary", role: "button", name: "Primary action" },
  { id: "governed-ui-button--secondary", role: "button", name: "Secondary action" },
  { id: "governed-ui-button--disabled", role: "button", name: "Unavailable action" },
  { id: "governed-ui-statuspanel--loading", state: "loading" },
  { id: "governed-ui-statuspanel--empty", state: "empty" },
  { id: "governed-ui-statuspanel--error", state: "error" },
  { id: "governed-ui-statuspanel--success", state: "success" },
  ...["navigation","hero","feature-grid","bento-grid","proof-cloud","metrics","testimonial","comparison","pricing","faq","cta","footer","editorial-prose","editorial-media","product-showcase","media-stage","graphics2d-stage","graphics3d-stage"].map((name)=>({id:`governed-sections-section--${name}`}))
] as const;

for (const story of stories) {
  test(`${story.id} renders production component with a11y and visual evidence`, async ({ page }, testInfo) => {
    const response = await page.goto(`/iframe.html?id=${story.id}&viewMode=story`, { waitUntil: "networkidle" });
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator("#storybook-root")).toBeVisible();
    if ("role" in story) {
      const button = page.getByRole(story.role, { name: story.name });
      await expect(button).toHaveCount(1);
      if (story.id.endsWith("--disabled")) await expect(button).toBeDisabled(); else await expect(button).toBeEnabled();
    }
    if ("state" in story) await expect(page.locator(`[data-state='${story.state}']`)).toHaveCount(1);
    if (story.id.endsWith("--primary")) await expect(page.getByRole("button", { name: "Primary action" })).toBeFocused();
    if (story.id.startsWith("governed-sections-section--")) await expect(page.locator("[data-governed-section]")).toHaveCount(1);
    const axe = await new AxeBuilder({ page }).analyze();
    const hardViolations = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(hardViolations.map((violation) => violation.id)).toEqual([]);
    const screenshotDirectory = join(process.cwd(), "artifacts", "storybook", "screenshots");
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, `${testInfo.project.name}--${story.id}.png`), fullPage: true });
  });
}
