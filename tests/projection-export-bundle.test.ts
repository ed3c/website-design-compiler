import assert from "node:assert/strict";
import test from "node:test";
import { createProjectionExportBundle, projectionDriftState, type ProjectionRecord } from "../src/projections/export-bundle.js";
import { validateAgainstSchema } from "../src/validate.js";

const h = (value: string) => value.repeat(64).slice(0, 64);

const records: ProjectionRecord[] = [
  {
    id: "issue-46",
    kind: "ISSUE",
    title: "Source plane",
    sourceUri: "https://github.com/ed3c/website-design-compiler/issues/46",
    sourceSha256: h("a"),
    accessClassification: "PUBLIC",
    fields: { state: "OPEN", phase: "P5", priority: 1 }
  },
  {
    id: "pr-55",
    kind: "PULL_REQUEST",
    title: "Source contract foundation",
    sourceUri: "https://github.com/ed3c/website-design-compiler/pull/55",
    sourceSha256: h("b"),
    accessClassification: "PUBLIC",
    fields: { draft: true, head: "8d973b78" }
  }
];

function baseInput() {
  return {
    bundleId: "architecture-routing",
    templateVersion: "v1",
    allowedAccessClassifications: ["PUBLIC"] as const,
    records,
    generatedAt: "2026-08-19T00:00:00.000Z"
  };
}

test("local projection bundle deterministically renders Markdown CSV and JSON without credentials", async () => {
  const first = createProjectionExportBundle(baseInput());
  const second = createProjectionExportBundle({ ...baseInput(), generatedAt: "2026-08-19T01:00:00.000Z", records: [...records].reverse() });

  assert.equal(first.bundleIdentitySha256, second.bundleIdentitySha256);
  assert.equal(first.sourceSetSha256, second.sourceSetSha256);
  assert.equal(first.recordCount, 2);
  assert.deepEqual(first.records.map((record) => record.id), ["issue-46", "pr-55"]);
  assert.match(first.outputs.markdown.content, /Projection Export/);
  assert.match(first.outputs.csv.content, /^id,kind,title,/);
  assert.match(first.outputs.json.content, /projection-record-set\/v1/);
  for (const artifact of Object.values(first.outputs)) assert.match(artifact.contentSha256, /^[a-f0-9]{64}$/);
  await validateAgainstSchema(first, "projection-export-bundle.schema.json");
});

test("canonical field ordering removes caller-map ordering drift", () => {
  const first = createProjectionExportBundle(baseInput());
  const changed = records.map((record) => record.id === "issue-46" ? { ...record, fields: { priority: 1, phase: "P5", state: "OPEN" } } : record);
  const second = createProjectionExportBundle({ ...baseInput(), records: changed });
  assert.equal(first.bundleIdentitySha256, second.bundleIdentitySha256);
});

test("source digest or template changes produce a new projection identity", () => {
  const first = createProjectionExportBundle(baseInput());
  const changedSource = records.map((record) => record.id === "issue-46" ? { ...record, sourceSha256: h("c") } : record);
  const second = createProjectionExportBundle({ ...baseInput(), records: changedSource });
  const third = createProjectionExportBundle({ ...baseInput(), templateVersion: "v2" });
  assert.notEqual(first.sourceSetSha256, second.sourceSetSha256);
  assert.notEqual(first.bundleIdentitySha256, second.bundleIdentitySha256);
  assert.notEqual(first.bundleIdentitySha256, third.bundleIdentitySha256);
});

test("access classification is checked before local export and never silently filtered", () => {
  const privateRecord: ProjectionRecord = { ...records[0]!, id: "private-source", accessClassification: "PRIVATE" };
  assert.throws(
    () => createProjectionExportBundle({ ...baseInput(), records: [privateRecord] }),
    /access PRIVATE is not admitted/
  );
  const allowed = createProjectionExportBundle({
    ...baseInput(),
    allowedAccessClassifications: ["PRIVATE"] as const,
    records: [privateRecord]
  });
  assert.equal(allowed.records[0]!.accessClassification, "PRIVATE");
});

test("unsafe source URIs credentials query data local paths and traversal fail closed", () => {
  for (const sourceUri of [
    "file:///tmp/private.txt",
    "../private.txt",
    "https://user:secret@example.test/evidence",
    "https://example.test/evidence?token=x",
    "http://example.test/evidence"
  ]) {
    assert.throws(
      () => createProjectionExportBundle({ ...baseInput(), records: [{ ...records[0]!, sourceUri }] }),
      /sourceUri/
    );
  }
});

test("duplicate record identities and malformed source hashes fail before bundle emission", () => {
  assert.throws(
    () => createProjectionExportBundle({ ...baseInput(), records: [records[0]!, records[0]!] }),
    /duplicate projection record id/
  );
  assert.throws(
    () => createProjectionExportBundle({ ...baseInput(), records: [{ ...records[0]!, sourceSha256: "bad" }] }),
    /exact SHA-256/
  );
});

test("drift is explicit CURRENT DRIFTED or UNKNOWN", () => {
  const current = h("d");
  assert.equal(projectionDriftState(current, current), "CURRENT");
  assert.equal(projectionDriftState(current, h("e")), "DRIFTED");
  assert.equal(projectionDriftState(current, null), "UNKNOWN");
  assert.throws(() => projectionDriftState(current, "bad"), /exact SHA-256/);
});
