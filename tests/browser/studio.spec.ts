import { expect, test } from "@playwright/test";

test("governed authoring render uses production registry components", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/studio/render", { waitUntil: "networkidle" });
  await expect(page.locator("[data-authoring-renderer='puck-production-registry']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open compiler contract" })).toBeVisible();
  await expect(page.getByText("Governed component plan emitted")).toBeVisible();
  await expect(page.locator("[data-authoring-section='true'][data-surface-token='surface-muted']")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("Payload-persisted published data renders through the same production registry", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/studio/render?source=payload", { waitUntil: "networkidle" });
  await expect(page.locator("main[data-authoring-source='payload']")).toBeVisible();
  await expect(page.locator("[data-authoring-renderer='puck-production-registry']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open compiler contract" })).toBeVisible();
  await expect(page.getByText("Governed component plan emitted")).toBeVisible();
  await expect(page.getByText("Newer draft content stored only in Payload versions")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("invalid authoring data fails closed before production registry render", async ({ page }) => {
  await page.goto("/studio/render?fixture=invalid", { waitUntil: "networkidle" });
  await expect(page.locator("main[data-authoring-rejected='true']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authoring data rejected" })).toBeVisible();
  await expect(page.locator("[data-authoring-renderer='puck-production-registry']")).toHaveCount(0);
  await expect(page.getByText(/not an approved governed component/)).toBeVisible();
});

test("Puck editor route loads as a separate governed authoring surface", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/studio", { waitUntil: "networkidle" });
  await expect(page.locator("[data-authoring-studio='true']")).toBeVisible();
  await expect(page.getByText("Website Design Compiler Studio")).toBeVisible();
  await expect(page.frameLocator("iframe").locator("[data-page-node]")).toHaveCount(7);
  expect(pageErrors).toEqual([]);
});
