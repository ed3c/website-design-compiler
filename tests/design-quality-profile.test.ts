import test from "node:test";
import assert from "node:assert/strict";
import { validateDesignQualityReleaseProfile, type DesignQualityReleaseProfile, type DesignQualityReleaseProfileV3 } from "../src/design-quality-profile.js";
import { validateAgainstSchema } from "../src/validate.js";

const valid:DesignQualityReleaseProfile={schema:"website-design-compiler/design-quality-release-profile/v2",id:"premium-web-v2",premiumQualityThreshold:78,originalitySimilarityThreshold:0.82,requiredViewports:["mobile","desktop"],requireExactEvidenceBinding:true};

test("premium v2 release profile governs threshold, originality and viewport evidence",()=>{
  assert.deepEqual(validateDesignQualityReleaseProfile(valid),[]);
});

test("invalid premium thresholds and incomplete viewport profile fail closed",()=>{
  const invalid={...valid,premiumQualityThreshold:101,originalitySimilarityThreshold:0,requiredViewports:["desktop"] as ("mobile"|"desktop")[]};
  const errors=validateDesignQualityReleaseProfile(invalid);
  assert.ok(errors.some((error)=>error.includes("premium quality threshold")));
  assert.ok(errors.some((error)=>error.includes("originality similarity threshold")));
  assert.ok(errors.some((error)=>error.includes("mobile and desktop")));
});

const validV3:DesignQualityReleaseProfileV3={
  schema:"website-design-compiler/design-quality-release-profile/v3",
  id:"premium-web-v3",
  premiumQualityThreshold:78,
  originalitySimilarityThreshold:0.82,
  requiredViewports:["mobile","desktop"],
  requireExactEvidenceBinding:true,
  evaluator:{schema:"website-design-compiler/design-quality-evaluator-config/v3",scoreModel:"runtime-evidence-weighted/v3",structuralSimilarity:"ordered-page-graph/v1",visualSimilarity:"calibrated-visual/v1"},
  calibrationReceipt:{path:"artifacts/v3/design-quality-calibration/design-quality-calibration-receipt.json",schema:"website-design-compiler/design-quality-calibration-receipt/v2"}
};

test("premium v3 profile pins the calibrated and ordered evaluator without lowering thresholds",async()=>{
  assert.deepEqual(validateDesignQualityReleaseProfile(validV3),[]);
  await validateAgainstSchema(validV3,"design-quality-release-profile-v3.schema.json");
});

test("premium v3 profile rejects threshold reductions and uncalibrated similarity methods",()=>{
  const invalid:DesignQualityReleaseProfileV3={...validV3,premiumQualityThreshold:77,originalitySimilarityThreshold:.81,evaluator:{...validV3.evaluator,visualSimilarity:"legacy-fingerprint/v1" as "calibrated-visual/v1"}};
  const errors=validateDesignQualityReleaseProfile(invalid);
  assert.ok(errors.some((error)=>error.includes("at least 78")));
  assert.ok(errors.some((error)=>error.includes("at least 0.82")));
  assert.ok(errors.some((error)=>error.includes("calibrated-visual/v1")));
});
