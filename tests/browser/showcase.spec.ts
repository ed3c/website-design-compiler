import { expect, test } from "@playwright/test";

test("showcase renders governed compiler projection with graphics disabled", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/showcase?graphics=off&graphics3d=off", { waitUntil: "networkidle" });
  const main = page.locator("main[data-showcase-project='evidence-first-showcase'][data-governed-renderer='nextjs-registry']");
  await expect(main).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Reference evidence becomes a governed");
  const action = page.getByRole("button", { name: "Open compiler contract" });
  await expect(action).toBeVisible();
  await action.focus();
  await expect(action).toBeFocused();
  await expect(page.getByText("Governed component plan emitted")).toBeVisible();
  await expect(page.locator("[data-pixi-state='fallback']")).toBeVisible();
  await expect(page.locator("[data-three-state='fallback']")).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
