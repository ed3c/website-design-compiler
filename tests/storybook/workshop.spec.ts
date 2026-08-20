import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const sectionStories = [
  { id: "governed-sections-section--navigation", kind: "navigation", variant: "minimal" },
  { id: "governed-sections-section--navigation-product", kind: "navigation", variant: "product" },
  { id: "governed-sections-section--hero", kind: "hero", variant: "text-first" },
  { id: "governed-sections-section--hero-split-media", kind: "hero", variant: "split-media" },
  { id: "governed-sections-section--hero-interactive", kind: "hero", variant: "interactive" },
  { id: "governed-sections-section--feature-grid", kind: "feature-grid", variant: "cards" },
  { id: "governed-sections-section--feature-grid-rows", kind: "feature-grid", variant: "rows" },
  { id: "governed-sections-section--feature-grid-icon-grid", kind: "feature-grid", variant: "icon-grid" },
  { id: "governed-sections-section--bento-grid", kind: "bento-grid", variant: "balanced" },
  { id: "governed-sections-section--bento-grid-asymmetric", kind: "bento-grid", variant: "asymmetric" },
  { id: "governed-sections-section--proof-cloud", kind: "proof-cloud", variant: "logos" },
  { id: "governed-sections-section--proof-cloud-citations", kind: "proof-cloud", variant: "citations" },
  { id: "governed-sections-section--metrics", kind: "metrics", variant: "inline" },
  { id: "governed-sections-section--metrics-grid", kind: "metrics", variant: "grid" },
  { id: "governed-sections-section--testimonial", kind: "testimonial", variant: "quote" },
  { id: "governed-sections-section--testimonial-carousel-shell", kind: "testimonial", variant: "carousel-shell" },
  { id: "governed-sections-section--comparison", kind: "comparison", variant: "table" },
  { id: "governed-sections-section--comparison-matrix", kind: "comparison", variant: "matrix" },
  { id: "governed-sections-section--pricing", kind: "pricing", variant: "tiers" },
  { id: "governed-sections-section--pricing-single-offer", kind: "pricing", variant: "single-offer" },
  { id: "governed-sections-section--faq", kind: "faq", variant: "accordion" },
  { id: "governed-sections-section--faq-list", kind: "faq", variant: "list" },
  { id: "governed-sections-section--cta", kind: "cta", variant: "band" },
  { id: "governed-sections-section--cta-split", kind: "cta", variant: "split" },
  { id: "governed-sections-section--footer", kind: "footer", variant: "compact" },
  { id: "governed-sections-section--footer-multi-column", kind: "footer", variant: "multi-column" },
  { id: "governed-sections-section--editorial-prose", kind: "editorial-prose", variant: "article" },
  { id: "governed-sections-section--editorial-prose-longform", kind: "editorial-prose", variant: "longform" },
  { id: "governed-sections-section--editorial-media", kind: "editorial-media", variant: "figure" },
  { id: "governed-sections-section--editorial-media-gallery", kind: "editorial-media", variant: "gallery" },
  { id: "governed-sections-section--product-showcase", kind: "product-showcase", variant: "split" },
  { id: "governed-sections-section--product-showcase-stage", kind: "product-showcase", variant: "stage" },
  { id: "governed-sections-section--media-stage", kind: "media-stage", variant: "image" },
  { id: "governed-sections-section--media-stage-video", kind: "media-stage", variant: "video" },
  { id: "governed-sections-section--graphics-2-d-stage", kind: "graphics-2d-stage", variant: "ambient" },
  { id: "governed-sections-section--graphics-2-d-stage-interactive", kind: "graphics-2d-stage", variant: "interactive" },
  { id: "governed-sections-section--graphics-3-d-stage", kind: "graphics-3d-stage", variant: "product" },
  { id: "governed-sections-section--graphics-3-d-stage-spatial", kind: "graphics-3d-stage", variant: "spatial" }
] as const;

const stories = [
  { id: "governed-ui-button--primary", role: "button", name: "Primary action" },
  { id: "governed-ui-button--secondary", role: "button", name: "Secondary action" },
  { id: "governed-ui-button--disabled", role: "button", name: "Unavailable action" },
  { id: "governed-ui-statuspanel--loading", state: "loading" },
  { id: "governed-ui-statuspanel--empty", state: "empty" },
  { id: "governed-ui-statuspanel--error", state: "error" },
  { id: "governed-ui-statuspanel--success", state: "success" },
  ...sectionStories
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
    if ("kind" in story && "variant" in story) {
      const section=page.locator(`[data-governed-section='${story.kind}']`);
      await expect(section).toHaveCount(1);
      await expect(section).toHaveAttribute("data-variant",story.variant);
    }
    if (story.id.endsWith("--navigation")) {
      for (const linkName of ["Overview", "Evidence", "Security"]) {
        await expect(page.getByRole("link", { name: linkName })).toBeVisible();
      }
    }
    const axe = await new AxeBuilder({ page }).analyze();
    const hardViolations = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(hardViolations.map((violation) => violation.id)).toEqual([]);
    const screenshotDirectory = join(process.cwd(), "artifacts", "storybook", "screenshots");
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, `${testInfo.project.name}--${story.id}.png`), fullPage: true });
  });
}
