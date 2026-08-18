import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { projectSectionContracts } from "../../src/section-projections.js";

type StoryProbe={id:string;role?:"button";name?:string;state?:string;kind?:string;variant?:string};
const stories:StoryProbe[] = [
  { id: "governed-ui-button--primary", role: "button", name: "Primary action" },
  { id: "governed-ui-button--secondary", role: "button", name: "Secondary action" },
  { id: "governed-ui-button--disabled", role: "button", name: "Unavailable action" },
  { id: "governed-ui-statuspanel--loading", state: "loading" },
  { id: "governed-ui-statuspanel--empty", state: "empty" },
  { id: "governed-ui-statuspanel--error", state: "error" },
  { id: "governed-ui-statuspanel--success", state: "success" },
  ...projectSectionContracts().flatMap((projection)=>projection.variantStories.map((story)=>({id:story.storyId,kind:projection.kind,variant:story.variant})))
];

for (const story of stories) {
  test(`${story.id} renders production component with a11y and visual evidence`, async ({ page }, testInfo) => {
    const response = await page.goto(`/iframe.html?id=${story.id}&viewMode=story`, { waitUntil: "networkidle" });
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator("#storybook-root")).toBeVisible();
    if (story.role && story.name) {
      const button = page.getByRole(story.role, { name: story.name });
      await expect(button).toHaveCount(1);
      if (story.id.endsWith("--disabled")) await expect(button).toBeDisabled(); else await expect(button).toBeEnabled();
    }
    if (story.state) await expect(page.locator(`[data-state='${story.state}']`)).toHaveCount(1);
    if (story.id.endsWith("--primary")) await expect(page.getByRole("button", { name: "Primary action" })).toBeFocused();
    if (story.kind && story.variant) {
      const section=page.locator(`[data-governed-section='${story.kind}']`);
      await expect(section).toHaveCount(1);
      await expect(section).toHaveAttribute("data-variant",story.variant);
    }
    const axe = await new AxeBuilder({ page }).analyze();
    const hardViolations = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(hardViolations.map((violation) => violation.id)).toEqual([]);
    const screenshotDirectory = join(process.cwd(), "artifacts", "storybook", "screenshots");
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, `${testInfo.project.name}--${story.id}.png`), fullPage: true });
  });
}
