import assert from "node:assert/strict";
import test from "node:test";
import { createPdfNotExercisedReceipt, createPdfSourceRequest } from "../src/source-plane/pdf-boundary.js";
import { validateAgainstSchema } from "../src/validate.js";

const h = (value: string) => value.repeat(64).slice(0, 64);

function baseInput() {
  return {
    sourceId: "planning-pdf",
    locator: "planning-pdf-digest",
    contentSha256: h("a"),
    byteLength: 1874321,
    accessClassification: "USER_PROVIDED" as const,
    publicationClassification: "DIGEST_ONLY" as const,
    extractionPolicySha256: h("b"),
    requestedParserAdmissionIdentitySha256: null,
    capturedAt: "2026-08-19T00:00:00.000Z"
  };
}

test("digest-only planning PDF produces deterministic NOT_EXERCISED receipt without source text", async () => {
  const first = createPdfSourceRequest(baseInput());
  const second = createPdfSourceRequest({ ...baseInput(), capturedAt: "2026-08-19T01:00:00.000Z" });
  assert.equal(first.requestIdentitySha256, second.requestIdentitySha256);
  const receipt = createPdfNotExercisedReceipt(first, "2026-08-19T02:00:00.000Z");
  assert.equal(receipt.state, "NOT_EXERCISED");
  assert.equal(receipt.reason, "PARSER_ADMISSION_ABSENT");
  assert.equal(receipt.parserAdmissionIdentitySha256, null);
  assert.equal(receipt.parserOutputSha256, null);
  assert.equal(receipt.publicText, null);
  assert.deepEqual(receipt.observations, []);
  await validateAgainstSchema(receipt, "pdf-parse-receipt.schema.json");
});

test("semantic PDF digest or extraction-policy drift changes request identity", () => {
  const first = createPdfSourceRequest(baseInput());
  const second = createPdfSourceRequest({ ...baseInput(), contentSha256: h("c") });
  const third = createPdfSourceRequest({ ...baseInput(), extractionPolicySha256: h("d") });
  assert.notEqual(first.requestIdentitySha256, second.requestIdentitySha256);
  assert.notEqual(first.requestIdentitySha256, third.requestIdentitySha256);
});

test("parser-neutral boundary rejects paths URLs malformed hashes and non-digest publication", () => {
  for (const locator of ["/tmp/source.pdf", "../source.pdf", "file:///tmp/source.pdf", "https://example.test/source.pdf", "C:\\private\\source.pdf"]) {
    assert.throws(() => createPdfSourceRequest({ ...baseInput(), locator }), /locator/);
  }
  assert.throws(() => createPdfSourceRequest({ ...baseInput(), contentSha256: "bad" }), /exact SHA-256/);
  assert.throws(() => createPdfSourceRequest({ ...baseInput(), byteLength: 0 }), /positive integer/);
  assert.throws(
    () => createPdfSourceRequest({ ...baseInput(), publicationClassification: "PUBLIC_BYTES" as never }),
    /DIGEST_ONLY/
  );
});

test("NOT_EXERCISED cannot impersonate an admitted parser run", () => {
  const admitted = createPdfSourceRequest({ ...baseInput(), requestedParserAdmissionIdentitySha256: h("e") });
  assert.throws(
    () => createPdfNotExercisedReceipt(admitted, "2026-08-19T02:00:00.000Z"),
    /only valid while parser admission is absent/
  );
});
