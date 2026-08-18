import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompletePageGraph } from "../../src/complete-page-graph";
import { pageGraphFingerprint, pageGraphToPuck } from "../../src/page-graph-roundtrip";

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

test("Puck editor consumes every production benchmark page graph", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const projection = JSON.parse(
    await readFile(join(process.cwd(), "apps/site/generated/benchmark-page-graphs.json"), "utf8")
  ) as { graphs: Record<string, CompletePageGraph> };
  for (const [category, graph] of Object.entries(projection.graphs)) {
    const fingerprint = pageGraphFingerprint(graph);
    await page.goto(`/studio?category=${category}`, { waitUntil: "networkidle" });
    await expect(page.locator(`[data-authoring-studio='true'][data-authoring-category='${category}']`)).toBeVisible();
    await expect(page.getByText("Website Design Compiler Studio")).toBeVisible();
    await expect(page.frameLocator("iframe").locator("[data-page-node]")).toHaveCount(graph.nodes.length);
    await page.getByText("Publish", { exact: true }).click();
    await expect(page.locator("[data-authoring-studio='true']"))
      .toHaveAttribute("data-published-fingerprint", fingerprint);
    const saved = await page.evaluate((key) => window.localStorage.getItem(key), `wdc:puck-page:${category}`);
    expect(saved).not.toBeNull();
  }
  expect(pageErrors).toEqual([]);
});

test("Puck publish readback rejects unknown blocks and extra properties", async ({ request }) => {
  const projection = JSON.parse(
    await readFile(join(process.cwd(), "apps/site/generated/benchmark-page-graphs.json"), "utf8")
  ) as { graphs: Record<string, CompletePageGraph> };
  const source = pageGraphToPuck(projection.graphs["b2b-product"]!);
  const unknownBlock = structuredClone(source) as unknown as Record<string, unknown>;
  (unknownBlock.content as Array<Record<string, unknown>>)[0]!.type = "RawHtml";
  const blockResponse = await request.post("/api/studio/publish", { data: unknownBlock });
  expect(blockResponse.status()).toBe(422);

  const extraProperty = structuredClone(source) as unknown as Record<string, unknown>;
  (extraProperty.root as { props: Record<string, unknown> }).props.unowned = true;
  const propertyResponse = await request.post("/api/studio/publish", { data: extraProperty });
  expect(propertyResponse.status()).toBe(422);
});

test("Puck editor rejects an unknown production graph category", async ({ page }) => {
  const response = await page.goto("/studio?category=unknown-graph", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(404);
  await expect(page.locator("[data-authoring-studio='true']")).toHaveCount(0);
});
