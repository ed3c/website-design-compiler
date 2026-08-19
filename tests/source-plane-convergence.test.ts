import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeArticleSource,
  normalizePdfDigestSource,
  normalizeRepositorySource
} from "../src/source-plane/index.js";

const g = (value: string) => value.repeat(40).slice(0, 40);
const h = (value: string) => value.repeat(64).slice(0, 64);
const bytes = (value: string) => new TextEncoder().encode(value);

test("article and exact repository adapters expose one normalized observed API", () => {
  const article = normalizeArticleSource({
    sourceId: "article-fixture",
    locator: "article-fixture",
    mediaType: "text/markdown",
    bytes: bytes("# Heading\nprivate prose should not be copied into HASH_ONLY statements"),
    accessClassification: "USER_PROVIDED",
    publicationClassification: "DIGEST_ONLY",
    capturedAt: "2026-08-19T00:00:00.000Z"
  });
  assert.equal(article.sourceClass, "ARTICLE");
  assert.equal(article.state, "OBSERVED");
  assert.equal(article.normalizedSourceIdentitySha256, article.result.manifest.sourceIdentitySha256);
  assert.match(article.result.observations[0]!.statement, /^article section 1 evidence sha256:/);
  assert.doesNotMatch(article.result.observations[0]!.statement, /private prose/);

  const repository = normalizeRepositorySource({
    sourceId: "repository-fixture",
    repository: "https://github.com/ed3c/website-design-compiler",
    commit: g("a"),
    tree: g("b"),
    files: [{ path: "src/example.ts", bytes: bytes("const privateValue = 1;\nexport const visible = true;") }],
    ranges: [{ path: "src/example.ts", startLine: 1, endLine: 2 }],
    accessClassification: "PUBLIC",
    publicationClassification: "DIGEST_ONLY",
    capturedAt: "2026-08-19T00:00:00.000Z"
  });
  assert.equal(repository.sourceClass, "GIT_REPOSITORY");
  assert.equal(repository.state, "OBSERVED");
  assert.equal(repository.normalizedSourceIdentitySha256, repository.result.manifest.sourceIdentitySha256);
  assert.match(repository.result.observations[0]!.statement, /^repository src\/example\.ts lines 1-2 evidence sha256:/);
  assert.doesNotMatch(repository.result.observations[0]!.statement, /privateValue/);
});

test("digest-only PDF occupies the same normalized API without pretending to parse", () => {
  const pdf = normalizePdfDigestSource({
    sourceId: "planning-pdf",
    locator: "planning-pdf-digest",
    contentSha256: h("c"),
    byteLength: 1874321,
    accessClassification: "USER_PROVIDED",
    publicationClassification: "DIGEST_ONLY",
    extractionPolicySha256: h("d"),
    requestedParserAdmissionIdentitySha256: null,
    capturedAt: "2026-08-19T00:00:00.000Z"
  }, "2026-08-19T00:10:00.000Z");
  assert.equal(pdf.sourceClass, "PDF");
  assert.equal(pdf.state, "NOT_EXERCISED");
  assert.equal(pdf.normalizedSourceIdentitySha256, pdf.request.requestIdentitySha256);
  assert.deepEqual(pdf.receipt.observations, []);
  assert.equal(pdf.receipt.parserOutputSha256, null);
  assert.equal(pdf.receipt.publicText, null);
});

test("semantic source drift changes normalized identity while capture time alone does not", () => {
  const base = {
    sourceId: "article-fixture",
    locator: "article-fixture",
    mediaType: "text/plain",
    bytes: bytes("stable text"),
    accessClassification: "USER_PROVIDED" as const,
    publicationClassification: "DIGEST_ONLY" as const,
    capturedAt: "2026-08-19T00:00:00.000Z"
  };
  const first = normalizeArticleSource(base);
  const recaptured = normalizeArticleSource({ ...base, capturedAt: "2026-08-19T01:00:00.000Z" });
  const changed = normalizeArticleSource({ ...base, bytes: bytes("changed text") });
  assert.equal(first.normalizedSourceIdentitySha256, recaptured.normalizedSourceIdentitySha256);
  assert.notEqual(first.normalizedSourceIdentitySha256, changed.normalizedSourceIdentitySha256);
});

test("adapter-specific safety boundaries survive convergence", () => {
  assert.throws(
    () => normalizeRepositorySource({
      sourceId: "bad-repository",
      repository: "https://github.com/ed3c/website-design-compiler",
      commit: "main",
      tree: g("b"),
      files: [{ path: "src/example.ts", bytes: bytes("x") }],
      ranges: [{ path: "src/example.ts", startLine: 1, endLine: 1 }],
      accessClassification: "PUBLIC",
      publicationClassification: "DIGEST_ONLY",
      capturedAt: "2026-08-19T00:00:00.000Z"
    }),
    /40-character Git SHA/
  );

  assert.throws(
    () => normalizePdfDigestSource({
      sourceId: "bad-pdf",
      locator: "/tmp/private.pdf",
      contentSha256: h("c"),
      byteLength: 1,
      accessClassification: "USER_PROVIDED",
      publicationClassification: "DIGEST_ONLY",
      extractionPolicySha256: h("d"),
      requestedParserAdmissionIdentitySha256: null,
      capturedAt: "2026-08-19T00:00:00.000Z"
    }, "2026-08-19T00:10:00.000Z"),
    /locator/
  );
});
