import test from "node:test";
import assert from "node:assert/strict";
import { ArtDirectionConflictError, routeArtDirection } from "../src/art-direction.js";
import { validateAgainstSchema } from "../src/validate.js";
import type { CompilerInput } from "../src/contracts.js";

const input: CompilerInput = {
  schema: "website-design-compiler/input/v1",
  project: "art-direction-fixture",
  brief: {
    pageType: "product-landing",
    audience: "design engineers",
    objective: "compile one coherent design direction"
  },
  requestedStages: ["art-direction"]
};

test("router accepts exactly one primary and demotes duplicate reviewer authority", async () => {
  const designRead = routeArtDirection(
    input,
    {
      primary: ["repo-native"],
      reviewers: ["repo-native", "google-stitch", "google-stitch"]
    },
    1
  );

  assert.equal(designRead.primaryAuthority, "repo-native");
  assert.deepEqual(designRead.reviewers, ["google-stitch"]);
  assert.equal(designRead.referenceEvidenceState, "PRESENT");
  await validateAgainstSchema(designRead, "design-read.schema.json");
});

test("router fails closed when multiple primary art directors are selected", () => {
  assert.throws(
    () =>
      routeArtDirection(
        input,
        { primary: ["anthropic-frontend-design", "google-stitch"] },
        0
      ),
    ArtDirectionConflictError
  );
});

test("router fails closed when no primary art director is selected", () => {
  assert.throws(() => routeArtDirection(input, { primary: [] }, 0), ArtDirectionConflictError);
});
