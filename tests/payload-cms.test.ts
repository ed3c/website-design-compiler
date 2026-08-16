import assert from "node:assert/strict";
import test from "node:test";
import authoringFixture from "../apps/site/generated/showcase-authoring-data.json" with { type: "json" };
import {
  CMS_LOCALES,
  MediaAssets,
  Pages,
  PAYLOAD_VERSION,
  Users,
  authoringToPayloadLayout,
  payloadLayoutToAuthoring
} from "../src/payload-cms.js";
import { validateAuthoringData, type AuthoringData } from "../src/puck-authoring.js";

test("Payload schema is pinned and owns pages, authenticated users, and provenance-linked media", () => {
  assert.equal(PAYLOAD_VERSION, "3.86.0");
  assert.deepEqual(CMS_LOCALES, ["en", "zh-TW"]);
  assert.equal(Users.slug, "cms-users");
  assert.ok(Users.auth);
  assert.equal(Pages.slug, "pages");
  assert.ok(Pages.versions);
  assert.equal(MediaAssets.slug, "media-assets");

  const mediaFieldNames = new Set(MediaAssets.fields.flatMap((field) => "name" in field && field.name ? [field.name] : []));
  for (const required of ["sha256", "provenanceReceiptPath", "modelIdentity", "outputTermsSubject", "rightsState"]) assert.ok(mediaFieldNames.has(required));
});

test("governed Puck authoring data round-trips through Payload block projection", () => {
  const source = authoringFixture as AuthoringData;
  assert.equal(validateAuthoringData(source).overall, "PASS");
  const layout = authoringToPayloadLayout(source);
  const restored = payloadLayoutToAuthoring(layout, source.root.props?.pageTitle ?? "showcase", source.root.props?.surfaceToken ?? "surface-default");
  assert.deepEqual(restored, source);
});

test("unknown Payload block types fail closed before production authoring render", () => {
  assert.throws(
    () => payloadLayoutToAuthoring([{ blockType: "raw-html", componentId: "escape", html: "<script>alert(1)</script>" }], "invalid", "surface-default"),
    /not governed/
  );
});

test("Payload section cannot bypass Puck recursive nesting constraint", () => {
  assert.throws(
    () => payloadLayoutToAuthoring([
      {
        blockType: "section",
        componentId: "outer",
        surfaceToken: "surface-default",
        content: [{ blockType: "section", componentId: "inner", surfaceToken: "surface-muted", content: [] }]
      }
    ], "invalid", "surface-default"),
    /not governed|cannot nest Section/
  );
});
