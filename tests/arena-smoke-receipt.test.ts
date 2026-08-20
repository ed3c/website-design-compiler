import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Arena writes a current FAIL receipt instead of retaining stale PASS when visual direction is blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-arena-fail-receipt-"));
  try {
    for (const path of ["fixtures/arena/benchmark-matrix.json", "fixtures/content/proof-evidence.txt"]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(resolve(path), join(root, path));
    }
    const visualPath = join(root, "artifacts/v2/visual-direction-search/receipt.json");
    await mkdir(dirname(visualPath), { recursive: true });
    await writeFile(visualPath, '{"schema":"website-design-compiler/visual-direction-benchmark-receipt/v2","overall":"FAIL"}\n', "utf8");
    const arenaPath = join(root, "artifacts/arena/arena-score.json");
    await mkdir(dirname(arenaPath), { recursive: true });
    await writeFile(arenaPath, '{"schema":"website-design-compiler/arena-score/v1","overall":"PASS"}\n', "utf8");
    let failure: unknown;
    try {
      await execFileAsync(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("scripts/arena-smoke.ts")], {
        cwd: root,
        env: { ...process.env, GITHUB_SHA: "a".repeat(40), GITHUB_REF: "refs/heads/review" }
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "the blocked Arena run must exit nonzero");
    const receipt = JSON.parse(await readFile(arenaPath, "utf8")) as { overall: string; git: { sha: string; ref: string }; categories: unknown[]; diagnostics: string[] };
    assert.equal(receipt.overall, "FAIL", JSON.stringify(failure));
    assert.deepEqual(receipt.git, { sha: "a".repeat(40), ref: "refs/heads/review" });
    assert.equal(receipt.categories.length, 6);
    assert.equal(receipt.diagnostics.length, 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
