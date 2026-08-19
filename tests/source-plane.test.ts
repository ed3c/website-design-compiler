import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  createByteSourceManifest,
  createGitSourceManifest,
  createSourceInferenceRecord,
  createSourceObservation,
  createUrlCaptureSourceManifest,
  sourceBytesMayBePublished,
  type ParserIdentity
} from "../src/source-plane/index.js";
import { validateAgainstSchema } from "../src/validate.js";

const parser: ParserIdentity = {
  name: "synthetic-source-reader",
  version: "1.0.0",
  configSha256: "a".repeat(64)
};
const policyA = "b".repeat(64);
const policyB = "c".repeat(64);

function byteManifest(bytes: Uint8Array, overrides: Partial<Parameters<typeof createByteSourceManifest>[0]> = {}) {
  return createByteSourceManifest({
    sourceId: "fixture-article-001",
    sourceClass: "ARTICLE",
    locator: "user-attachment:fixture-article-001",
    mediaType: "text/plain",
    bytes,
    accessClassification: "USER_PROVIDED",
    publicationClassification: "DIGEST_ONLY",
    parser,
    extractionPolicySha256: policyA,
    capturedAt: "2026-08-19T12:00:00.000Z",
    ...overrides
  });
}

test("same bytes, parser and extraction policy keep a stable source identity across capture metadata", async () => {
  const bytes = await readFile(resolve("fixtures/source-plane/article.txt"));
  const first = byteManifest(bytes, { warnings: ["first capture warning"] });
  const second = byteManifest(bytes, {
    capturedAt: "2026-08-19T13:00:00.000Z",
    warnings: ["different non-identity warning"]
  });

  assert.equal(first.subject.kind, "BYTES");
  assert.equal(second.subject.kind, "BYTES");
  if (first.subject.kind !== "BYTES" || second.subject.kind !== "BYTES") throw new Error("unexpected subject kind");
  assert.equal(first.subject.contentSha256, second.subject.contentSha256);
  assert.equal(first.sourceIdentitySha256, second.sourceIdentitySha256);
  await validateAgainstSchema(first, "source-manifest.schema.json");
  await validateAgainstSchema(second, "source-manifest.schema.json");
});

test("changed bytes, parser configuration, or extraction policy creates a new source identity", async () => {
  const bytes = await readFile(resolve("fixtures/source-plane/article.txt"));
  const baseline = byteManifest(bytes);
  const changedBytes = byteManifest(Buffer.concat([bytes, Buffer.from("changed\n")]));
  const changedParser = byteManifest(bytes, {
    parser: { ...parser, configSha256: "d".repeat(64) }
  });
  const changedPolicy = byteManifest(bytes, { extractionPolicySha256: policyB });

  assert.notEqual(changedBytes.sourceIdentitySha256, baseline.sourceIdentitySha256);
  assert.notEqual(changedParser.sourceIdentitySha256, baseline.sourceIdentitySha256);
  assert.notEqual(changedPolicy.sourceIdentitySha256, baseline.sourceIdentitySha256);
});

test("PDF byte admission requires the PDF signature and does not pretend to parse the document", async () => {
  const validSignature = await readFile(resolve("fixtures/source-plane/valid-signature.pdf"));
  const malformed = await readFile(resolve("fixtures/source-plane/malformed.pdf"));
  const manifest = createByteSourceManifest({
    sourceId: "fixture-pdf-001",
    sourceClass: "PDF",
    locator: "user-attachment:fixture-pdf-001",
    mediaType: "application/pdf",
    bytes: validSignature,
    accessClassification: "USER_PROVIDED",
    publicationClassification: "DIGEST_ONLY",
    parser,
    extractionPolicySha256: policyA,
    capturedAt: "2026-08-19T12:00:00.000Z",
    warnings: ["signature-only fixture; parser success is not claimed"]
  });

  await validateAgainstSchema(manifest, "source-manifest.schema.json");
  assert.throws(
    () => createByteSourceManifest({
      sourceId: "fixture-pdf-bad",
      sourceClass: "PDF",
      locator: "user-attachment:fixture-pdf-bad",
      mediaType: "application/pdf",
      bytes: malformed,
      accessClassification: "USER_PROVIDED",
      publicationClassification: "DIGEST_ONLY",
      parser,
      extractionPolicySha256: policyA,
      capturedAt: "2026-08-19T12:00:00.000Z"
    }),
    /PDF signature/
  );
});

test("Git source identity requires exact commit/tree SHAs and traversal-free selected paths", async () => {
  const manifest = createGitSourceManifest({
    sourceId: "fixture-repository-001",
    repository: "https://github.com/ed3c/website-design-compiler",
    commit: "1".repeat(40),
    tree: "2".repeat(40),
    paths: ["src/compiler.ts", "README.md", "src/compiler.ts"],
    accessClassification: "PUBLIC",
    publicationClassification: "PUBLIC_BYTES",
    parser,
    extractionPolicySha256: policyA,
    capturedAt: "2026-08-19T12:00:00.000Z"
  });

  assert.equal(manifest.subject.kind, "GIT");
  if (manifest.subject.kind !== "GIT") throw new Error("unexpected subject kind");
  assert.deepEqual(manifest.subject.paths, ["README.md", "src/compiler.ts"]);
  await validateAgainstSchema(manifest, "source-manifest.schema.json");

  assert.throws(
    () => createGitSourceManifest({
      sourceId: "fixture-repository-branch",
      repository: "https://github.com/ed3c/website-design-compiler",
      commit: "main",
      tree: "2".repeat(40),
      paths: ["README.md"],
      accessClassification: "PUBLIC",
      publicationClassification: "PUBLIC_BYTES",
      parser,
      extractionPolicySha256: policyA,
      capturedAt: "2026-08-19T12:00:00.000Z"
    }),
    /exact 40-character Git SHA/
  );
  assert.throws(
    () => createGitSourceManifest({
      sourceId: "fixture-repository-traversal",
      repository: "https://github.com/ed3c/website-design-compiler",
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      paths: ["../private"],
      accessClassification: "PUBLIC",
      publicationClassification: "PUBLIC_BYTES",
      parser,
      extractionPolicySha256: policyA,
      capturedAt: "2026-08-19T12:00:00.000Z"
    }),
    /traversal/
  );
});

test("URL capture manifests keep redirect lineage and refuse credential/query-bearing public locators", async () => {
  const bytes = Buffer.from("<html><body>public fixture</body></html>\n");
  const manifest = createUrlCaptureSourceManifest({
    sourceId: "fixture-url-001",
    requestedUrl: "https://example.com/source",
    finalUrl: "https://example.com/final",
    redirectChain: [{ status: 302, fromUrl: "https://example.com/source", toUrl: "https://example.com/final" }],
    mediaType: "text/html",
    bytes,
    accessClassification: "PUBLIC",
    publicationClassification: "DIGEST_ONLY",
    parser,
    extractionPolicySha256: policyA,
    capturedAt: "2026-08-19T12:00:00.000Z"
  });
  await validateAgainstSchema(manifest, "source-manifest.schema.json");

  assert.throws(
    () => createUrlCaptureSourceManifest({
      sourceId: "fixture-url-query",
      requestedUrl: "https://example.com/source?token=redacted",
      finalUrl: "https://example.com/source?token=redacted",
      mediaType: "text/html",
      bytes,
      accessClassification: "PUBLIC",
      publicationClassification: "DIGEST_ONLY",
      parser,
      extractionPolicySha256: policyA,
      capturedAt: "2026-08-19T12:00:00.000Z"
    }),
    /query or fragment/
  );
  assert.throws(
    () => createUrlCaptureSourceManifest({
      sourceId: "fixture-url-credential",
      requestedUrl: "https://user:password@example.com/source",
      finalUrl: "https://user:password@example.com/source",
      mediaType: "text/html",
      bytes,
      accessClassification: "PUBLIC",
      publicationClassification: "DIGEST_ONLY",
      parser,
      extractionPolicySha256: policyA,
      capturedAt: "2026-08-19T12:00:00.000Z"
    }),
    /credentials/
  );
});

test("observations require exact anchors and evidence while inference remains a separate schema", async () => {
  const bytes = await readFile(resolve("fixtures/source-plane/article.txt"));
  const manifest = byteManifest(bytes);
  const evidence = Buffer.from("This text is intentionally synthetic and public.");
  const observation = createSourceObservation({
    sourceIdentitySha256: manifest.sourceIdentitySha256,
    statement: "The synthetic fixture declares that its text is public.",
    anchors: [{ kind: "LINES", startLine: 2, endLine: 2 }],
    evidenceBytes: evidence,
    parser
  });
  await validateAgainstSchema(observation, "source-observation.schema.json");

  assert.throws(
    () => createSourceObservation({
      sourceIdentitySha256: manifest.sourceIdentitySha256,
      statement: "Unanchored claim",
      anchors: [],
      evidenceBytes: evidence,
      parser
    }),
    /at least one exact source anchor/
  );
  assert.throws(
    () => createSourceObservation({
      sourceIdentitySha256: manifest.sourceIdentitySha256,
      statement: "Bad range",
      anchors: [{ kind: "LINES", startLine: 3, endLine: 2 }],
      evidenceBytes: evidence,
      parser
    }),
    /endLine must be greater/
  );

  const inference = createSourceInferenceRecord({
    statement: "A future adapter might use this observation as planning evidence.",
    basisObservationIdentitySha256: [observation.observationIdentitySha256],
    modelIdentity: "fixture-model@1"
  });
  assert.equal(observation.claimClass, "OBSERVATION");
  assert.equal(inference.claimClass, "INFERENCE");
  await validateAgainstSchema(inference, "source-inference.schema.json");
  await assert.rejects(validateAgainstSchema(inference, "source-observation.schema.json"));
});

test("digest-only and prohibited source records never serialize source bytes", async () => {
  const privateBytes = Buffer.from("private payload that must not be serialized");
  const prohibited = byteManifest(privateBytes, {
    accessClassification: "PRIVATE",
    publicationClassification: "PROHIBITED"
  });
  const publicBytes = byteManifest(Buffer.from("public payload"), {
    sourceId: "fixture-public-001",
    locator: "public-fixture:fixture-public-001",
    accessClassification: "PUBLIC",
    publicationClassification: "PUBLIC_BYTES"
  });

  assert.equal(sourceBytesMayBePublished(prohibited), false);
  assert.equal(sourceBytesMayBePublished(publicBytes), true);
  assert.doesNotMatch(JSON.stringify(prohibited), /private payload that must not be serialized/);
  await validateAgainstSchema(prohibited, "source-manifest.schema.json");
});
