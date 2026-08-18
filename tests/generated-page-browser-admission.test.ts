import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  GENERATED_PAGE_BROWSER_TRUST_SOURCE_PATHS,
  generatedPageBrowserTrustSourceSha256,
  generatedPageObservationSetSha256,
  generatedPageScreenshotSetSha256,
  validateTrustedGeneratedPageBrowserAdmission
} from "../src/generated-page-browser-admission.js";

const git = { sha: "a".repeat(40), ref: "refs/heads/review" };

test("generated-page browser admission requires an external hash and binds sources, receipt, and evidence sets", async () => {
  const root = await mkdtemp(join(tmpdir(), "wdc-generated-browser-admission-"));
  const previousTrustedSha256 = process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_SHA256;
  const previousAdmissionBase64 = process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_BASE64;
  try {
    for (const path of GENERATED_PAGE_BROWSER_TRUST_SOURCE_PATHS) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(resolve(path), join(root, path));
    }
    const generatedReceipt = {
      schema: "website-design-compiler/generated-page-browser-receipt/v3",
      overall: "PASS",
      git,
      evidence: [{
        category: "b2b-product",
        project: "desktop-chromium",
        path: "screenshots/desktop-chromium--b2b-product.png",
        sha256: "b".repeat(64),
      }],
      qualityEvidence:[{category:"b2b-product",project:"desktop-chromium",viewport:"desktop",path:"observations/desktop-chromium--b2b-product.json",sha256:"c".repeat(64),screenshotSha256:"b".repeat(64)}]
    };
    const generatedReceiptBytes = Buffer.from(`${JSON.stringify(generatedReceipt, null, 2)}\n`);
    const admission = {
      schema: "website-design-compiler/generated-page-browser-admission/v1",
      state: "PASS",
      producer: "playwright-generated-page-observation/v1",
      subject: git,
      sourceFilesSha256: await generatedPageBrowserTrustSourceSha256(root),
      generatedPageReceiptSha256: createHash("sha256").update(generatedReceiptBytes).digest("hex"),
      screenshotSetSha256: generatedPageScreenshotSetSha256(generatedReceipt)!,
      observationSetSha256: generatedPageObservationSetSha256(generatedReceipt)!,
      authority: { kind: "repository-administrator", identity: "external-release-controller", admittedAt: "2026-08-19T00:00:00.000Z" }
    };
    const admissionBytes = Buffer.from(`${JSON.stringify(admission, null, 2)}\n`);
    process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_BASE64 = admissionBytes.toString("base64");
    process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_SHA256 = createHash("sha256").update(admissionBytes).digest("hex");

    assert.deepEqual(await validateTrustedGeneratedPageBrowserAdmission(root, generatedReceiptBytes, generatedReceipt, git), []);
    assert.match(
      (await validateTrustedGeneratedPageBrowserAdmission(root, Buffer.from("different receipt bytes"), generatedReceipt, git)).join("; "),
      /does not bind the generated-page receipt bytes/
    );

    await writeFile(join(root, "scripts/generated-page-browser-receipt.ts"), "changed producer\n", "utf8");
    assert.match(
      (await validateTrustedGeneratedPageBrowserAdmission(root, generatedReceiptBytes, generatedReceipt, git)).join("; "),
      /does not bind the current producer and verifier sources/
    );
  } finally {
    if (previousTrustedSha256 === undefined) delete process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_SHA256;
    else process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_SHA256 = previousTrustedSha256;
    if(previousAdmissionBase64===undefined)delete process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_BASE64;
    else process.env.WDC_GENERATED_PAGE_BROWSER_ADMISSION_BASE64=previousAdmissionBase64;
    await rm(root, { recursive: true, force: true });
  }
});
