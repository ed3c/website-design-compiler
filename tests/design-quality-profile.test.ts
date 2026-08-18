import test from "node:test";
import assert from "node:assert/strict";
import { validateDesignQualityReleaseProfile, type DesignQualityReleaseProfile } from "../src/design-quality-profile.js";

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
