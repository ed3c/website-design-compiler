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
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Reference evidence becomes a governed");
  await expect(page.getByRole("heading", { level: 2, name: "State the product promise and primary action." })).toBeVisible();
  await expect(page.locator("[data-frontend-component='rich-section']")).toHaveCount(6);
  await expect(page.locator("[data-governed-section='navigation']")).toBeVisible();
  await expect(page.locator("[data-governed-section='hero']")).toBeVisible();
  await expect(page.locator("[data-governed-section='proof-cloud']")).toBeVisible();
  const action = page.getByRole("link", { name: "Continue" }).first();
  await expect(action).toBeVisible();
  await action.focus();
  await expect(action).toBeFocused();
  await expect(page.getByText("Omit proof section until evidence is supplied.")).toBeVisible();

  const graphics2d = page.locator("section[data-graphics-state='fallback']");
  await expect(graphics2d).toBeVisible();
  await expect(graphics2d.locator("[data-static-poster='true']")).toBeVisible();

  const graphics3d = page.locator("section[data-graphics3d-state='fallback'][data-graphics3d-enabled='false']");
  await expect(graphics3d).toBeVisible();
  await expect(graphics3d.locator("[data-graphics3d-static-poster='true']")).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
