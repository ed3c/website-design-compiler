import assert from "node:assert/strict";
import test from "node:test";
import { adaptArticle } from "../src/source-plane/article-adapter.js";
import { validateAgainstSchema } from "../src/validate.js";

const bytes = new TextEncoder().encode("# Alpha\nSecret paragraph\n\n## Beta\nSecond section\n");

function baseInput() {
  return {
    sourceId: "article-adapter-fixture",
    locator: "fixture:article-adapter",
    mediaType: "text/markdown",
    bytes,
    accessClassification: "USER_PROVIDED" as const,
    publicationClassification: "DIGEST_ONLY" as const,
    capturedAt: "2026-08-19T00:00:00.000Z"
  };
}

test("article adapter emits deterministic manifest and exact line observations without leaking digest-only text", async () => {
  const first = adaptArticle(baseInput());
  const second = adaptArticle({ ...baseInput(), capturedAt: "2026-08-19T01:00:00.000Z" });

  assert.equal(first.manifest.sourceIdentitySha256, second.manifest.sourceIdentitySha256);
  assert.equal(first.manifest.subject.kind, "BYTES");
  assert.equal(first.sectionCount, 2);
  assert.equal(first.observations.length, 2);
  assert.deepEqual(first.observations.map((observation) => observation.anchors[0]), [
    { kind: "LINES", startLine: 1, endLine: 3 },
    { kind: "LINES", startLine: 4, endLine: 6 }
  ]);
  assert.doesNotMatch(JSON.stringify(first), /Secret paragraph|Second section/);

  await validateAgainstSchema(first.manifest, "source-manifest.schema.json");
  for (const observation of first.observations) {
    await validateAgainstSchema(observation, "source-observation.schema.json");
    assert.match(observation.statement, /^article section \d+ evidence sha256:[a-f0-9]{64}$/);
  }
});

test("article extraction policy changes source identity while capture time does not", () => {
  const hashOnly = adaptArticle({
    ...baseInput(),
    publicationClassification: "PUBLIC_BYTES",
    observationMode: "HASH_ONLY"
  });
  const excerpt = adaptArticle({
    ...baseInput(),
    publicationClassification: "PUBLIC_BYTES",
    observationMode: "EXCERPT",
    maxExcerptCharacters: 80
  });

  assert.notEqual(hashOnly.manifest.sourceIdentitySha256, excerpt.manifest.sourceIdentitySha256);
  assert.match(excerpt.observations[0]!.statement, /^# Alpha Secret paragraph/);
});

test("article adapter refuses source excerpts unless publication is PUBLIC_BYTES", () => {
  assert.throws(
    () => adaptArticle({ ...baseInput(), observationMode: "EXCERPT" }),
    /EXCERPT observations require PUBLIC_BYTES/
  );
});

test("article adapter fails closed for unsupported media and invalid UTF-8", () => {
  assert.throws(
    () => adaptArticle({ ...baseInput(), mediaType: "text/html" }),
    /unsupported article media type/
  );
  assert.throws(
    () => adaptArticle({ ...baseInput(), bytes: new Uint8Array([0xc3, 0x28]) }),
    /valid UTF-8/
  );
});

test("plain text stays one structural section and empty text is rejected", () => {
  const plain = adaptArticle({
    ...baseInput(),
    mediaType: "text/plain",
    bytes: new TextEncoder().encode("one\ntwo")
  });
  assert.equal(plain.sectionCount, 1);
  assert.deepEqual(plain.observations[0]!.anchors[0], { kind: "LINES", startLine: 1, endLine: 2 });

  assert.throws(
    () => adaptArticle({ ...baseInput(), bytes: new TextEncoder().encode(" \n\t") }),
    /non-whitespace content/
  );
});
