import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("a failed current design-quality run overwrites a stale PASS receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-design-quality-fail-receipt-"));
  try {
    const proofPath = "fixtures/content/proof-evidence.txt";
    await mkdir(dirname(join(root, proofPath)), { recursive: true });
    await copyFile(resolve(proofPath), join(root, proofPath));
    const receiptPath = join(root, "artifacts/v2/design-quality/design-quality-eval-receipt.json");
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, '{"schema":"website-design-compiler/design-quality-eval-receipt/v2","overall":"PASS"}\n', "utf8");
    let failure: unknown;
    try {
      await execFileAsync(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("scripts/design-quality-eval-receipt.ts")], {
        cwd: root,
        env: { ...process.env, GITHUB_SHA: "a".repeat(40), GITHUB_REF: "refs/heads/review" }
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "the incomplete design-quality run must exit nonzero");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { overall: string; git: { sha: string; ref: string }; diagnostics: string[] };
    assert.equal(receipt.overall, "FAIL", JSON.stringify(failure));
    assert.deepEqual(receipt.git, { sha: "a".repeat(40), ref: "refs/heads/review" });
    assert.ok(receipt.diagnostics.length > 0, "the current failure must be retained in the replacement receipt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
