import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CompilerInput } from "../src/contracts.js";
import { buildFrontendPlan } from "../src/frontend-builder.js";
import { exportFrontendPlan, importFrontendPlan, validateAuthoringData, type FrontendPlanLike } from "../src/puck-authoring.js";

test("compiler frontend plan round-trips through governed authoring data", async () => {
  const raw = JSON.parse(await readFile(new URL("../apps/site/generated/showcase-frontend-plan.json", import.meta.url), "utf8")) as FrontendPlanLike;
  const data = importFrontendPlan(raw);
  assert.equal(validateAuthoringData(data).overall, "PASS");
  assert.deepEqual(exportFrontendPlan(data, raw.project), raw);
});

test("compiler rich-section output round-trips through governed authoring without field loss", () => {
  const input: CompilerInput = {
    schema: "website-design-compiler/input/v1",
    project: "rich-authoring-roundtrip",
    brief: {
      pageType: "interactive-3d",
      audience: "evaluation teams",
      objective: "inspect a governed spatial experience"
    },
    requestedStages: ["information-architecture", "content-architecture", "frontend-builder"]
  };
  const plan = buildFrontendPlan(input);
  assert.ok(plan.components.every((component) => component.component === "rich-section"));
  assert.deepEqual(exportFrontendPlan(importFrontendPlan(plan), input.project), plan);
});

test("unknown component type fails closed", () => {
  const result = validateAuthoringData({
    content: [{ type: "RawHtml", props: { id: "x", html: "<script>alert(1)</script>" } }],
    root: {}
  });
  assert.equal(result.overall, "FAIL");
  assert.match(result.errors.join("\n"), /not an approved governed component/);
});

test("approved component rejects arbitrary props", () => {
  const result = validateAuthoringData({
    content: [{ type: "ButtonBlock", props: { id: "b", label: "Go", intent: "primary", style: "position:fixed" } }],
    root: {}
  });
  assert.equal(result.overall, "FAIL");
  assert.match(result.errors.join("\n"), /not an approved prop/);
});

test("Section slot allows governed leaf components but forbids recursive Section nesting", () => {
  const pass = validateAuthoringData({
    content: [{
      type: "Section",
      props: {
        id: "section-1",
        surfaceToken: "surface-muted",
        content: [{ type: "ButtonBlock", props: { id: "button-1", label: "Continue", intent: "secondary" } }]
      }
    }],
    root: { props: { pageTitle: "Fixture", surfaceToken: "surface-default" } }
  });
  assert.equal(pass.overall, "PASS");

  const fail = validateAuthoringData({
    content: [{
      type: "Section",
      props: {
        id: "section-1",
        surfaceToken: "surface-muted",
        content: [{ type: "Section", props: { id: "section-2", surfaceToken: "surface-default", content: [] } }]
      }
    }],
    root: {}
  });
  assert.equal(fail.overall, "FAIL");
  assert.match(fail.errors.join("\n"), /cannot nest Section inside Section/);
});

test("design token fields reject raw color values", () => {
  const result = validateAuthoringData({ content: [], root: { props: { surfaceToken: "#ff0000" } } });
  assert.equal(result.overall, "FAIL");
  assert.match(result.errors.join("\n"), /approved design token/);
});
