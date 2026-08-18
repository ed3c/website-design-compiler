import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("a failed current visual-direction run overwrites a stale PASS receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-visual-direction-fail-receipt-"));
  try {
    for (const path of [
      "fixtures/arena/benchmark-matrix.json",
      "fixtures/content/proof-evidence.txt",
      "artifacts/reference-browser/observed-visual-fingerprint.json"
    ]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(resolve(path), join(root, path));
    }
    const receiptPath = join(root, "artifacts/v2/visual-direction-search/receipt.json");
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, '{"schema":"website-design-compiler/visual-direction-benchmark-receipt/v2","overall":"PASS"}\n', "utf8");
    let failure: unknown;
    try {
      await execFileAsync(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("scripts/visual-direction-benchmark-receipt.ts")], {
        cwd: root,
        env: { ...process.env, GITHUB_SHA: "a".repeat(40), GITHUB_REF: "refs/heads/review", WDC_REFERENCE_BROWSER_ADMISSION_SHA256: "" }
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "the unadmitted benchmark must exit nonzero");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { overall: string; git: { sha: string; ref: string }; diagnostics: string[] };
    assert.equal(receipt.overall, "FAIL", JSON.stringify(failure));
    assert.deepEqual(receipt.git, { sha: "a".repeat(40), ref: "refs/heads/review" });
    assert.ok(receipt.diagnostics.length > 0, "the current failure must be retained in the replacement receipt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
