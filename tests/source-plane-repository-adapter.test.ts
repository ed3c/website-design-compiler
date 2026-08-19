import assert from "node:assert/strict";
import test from "node:test";
import { adaptRepositorySnapshot } from "../src/source-plane/repository-adapter.js";
import { validateAgainstSchema } from "../src/validate.js";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const readme = new TextEncoder().encode("# Project\nFirst fact\nSecond fact\n");
const agents = new TextEncoder().encode("policy one\npolicy two\n");

function baseInput() {
  return {
    sourceId: "repository-adapter-fixture",
    repository: "https://github.com/ed3c/website-design-compiler",
    commit,
    tree,
    files: [
      { path: "README.md", bytes: readme },
      { path: "AGENTS.md", bytes: agents }
    ],
    ranges: [
      { path: "README.md", startLine: 1, endLine: 2 },
      { path: "AGENTS.md", startLine: 2, endLine: 2 }
    ],
    accessClassification: "PUBLIC" as const,
    publicationClassification: "DIGEST_ONLY" as const,
    capturedAt: "2026-08-19T00:00:00.000Z"
  };
}

test("repository adapter emits deterministic exact-Git manifest and sorted path-line observations", async () => {
  const first = adaptRepositorySnapshot(baseInput());
  const reordered = adaptRepositorySnapshot({
    ...baseInput(),
    capturedAt: "2026-08-19T01:00:00.000Z",
    files: [...baseInput().files].reverse(),
    ranges: [...baseInput().ranges].reverse()
  });

  assert.equal(first.manifest.sourceIdentitySha256, reordered.manifest.sourceIdentitySha256);
  assert.equal(first.manifest.subject.kind, "GIT");
  if (first.manifest.subject.kind === "GIT") {
    assert.deepEqual(first.manifest.subject.paths, ["AGENTS.md", "README.md"]);
    assert.equal(first.manifest.subject.commit, commit);
    assert.equal(first.manifest.subject.tree, tree);
  }
  assert.deepEqual(first.observations.map((observation) => observation.anchors[0]), [
    { kind: "GIT_PATH", path: "AGENTS.md", startLine: 2, endLine: 2 },
    { kind: "GIT_PATH", path: "README.md", startLine: 1, endLine: 2 }
  ]);
  assert.doesNotMatch(JSON.stringify(first), /First fact|Second fact|policy two/);

  await validateAgainstSchema(first.manifest, "source-manifest.schema.json");
  for (const observation of first.observations) {
    await validateAgainstSchema(observation, "source-observation.schema.json");
    assert.match(observation.statement, /^repository .+ evidence sha256:[a-f0-9]{64}$/);
  }
});

test("commit, tree, or extraction selection drift changes repository source identity", () => {
  const original = adaptRepositorySnapshot(baseInput());
  const changedCommit = adaptRepositorySnapshot({ ...baseInput(), commit: "c".repeat(40) });
  const changedTree = adaptRepositorySnapshot({ ...baseInput(), tree: "d".repeat(40) });
  const changedRange = adaptRepositorySnapshot({
    ...baseInput(),
    ranges: [{ path: "README.md", startLine: 2, endLine: 3 }]
  });

  assert.notEqual(original.manifest.sourceIdentitySha256, changedCommit.manifest.sourceIdentitySha256);
  assert.notEqual(original.manifest.sourceIdentitySha256, changedTree.manifest.sourceIdentitySha256);
  assert.notEqual(original.manifest.sourceIdentitySha256, changedRange.manifest.sourceIdentitySha256);
});

test("repository adapter rejects branch names, abbreviated identities, traversal and unknown ranges", () => {
  assert.throws(() => adaptRepositorySnapshot({ ...baseInput(), commit: "main" }), /40-character Git SHA/);
  assert.throws(() => adaptRepositorySnapshot({ ...baseInput(), tree: "abc1234" }), /40-character Git SHA/);
  assert.throws(
    () => adaptRepositorySnapshot({
      ...baseInput(),
      files: [{ path: "../secret.txt", bytes: readme }],
      ranges: [{ path: "../secret.txt", startLine: 1, endLine: 1 }]
    }),
    /traversal/
  );
  assert.throws(
    () => adaptRepositorySnapshot({
      ...baseInput(),
      ranges: [{ path: "missing.ts", startLine: 1, endLine: 1 }]
    }),
    /unknown path/
  );
});

test("repository adapter rejects range overflow, invalid UTF-8, duplicate ranges and non-public Git subjects", () => {
  assert.throws(
    () => adaptRepositorySnapshot({ ...baseInput(), ranges: [{ path: "README.md", startLine: 1, endLine: 99 }] }),
    /exceeds README.md line count/
  );
  assert.throws(
    () => adaptRepositorySnapshot({
      ...baseInput(),
      files: [{ path: "bad.txt", bytes: new Uint8Array([0xc3, 0x28]) }],
      ranges: [{ path: "bad.txt", startLine: 1, endLine: 1 }]
    }),
    /valid UTF-8/
  );
  assert.throws(
    () => adaptRepositorySnapshot({ ...baseInput(), ranges: [baseInput().ranges[0]!, baseInput().ranges[0]!] }),
    /duplicate repository observation range/
  );
  assert.throws(
    () => adaptRepositorySnapshot({ ...baseInput(), accessClassification: "PRIVATE" }),
    /limited to PUBLIC GitHub subjects/
  );
});

test("repository source excerpts require explicit PUBLIC_BYTES publication", () => {
  assert.throws(
    () => adaptRepositorySnapshot({ ...baseInput(), observationMode: "EXCERPT" }),
    /EXCERPT observations require PUBLIC_BYTES/
  );

  const excerpt = adaptRepositorySnapshot({
    ...baseInput(),
    publicationClassification: "PUBLIC_BYTES",
    observationMode: "EXCERPT",
    maxExcerptCharacters: 40
  });
  assert.equal(excerpt.observations[0]!.statement, "policy two");
});
