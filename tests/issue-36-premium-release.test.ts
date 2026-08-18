import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIssue36PremiumRelease } from "../scripts/issue-36-premium-release-receipt.js";
import { validateAgainstSchema } from "../src/validate.js";

const sha="a".repeat(40);const tree="b".repeat(40);const digest="c".repeat(64);const ref="refs/heads/test";
const categories=["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"];
const evaluator={schema:"website-design-compiler/design-quality-eval-receipt/v3",overall:"PASS",git:{sha,ref},releaseProfile:{premiumQualityThreshold:78,originalitySimilarityThreshold:.82},calibration:{state:"PASS",exactObservationSetBound:true},categoryCount:6,viewportCoverage:{mobile:6,desktop:6},exactHeadBound:true,allEvidenceBound:true,allStructuralPass:true,allOriginalityPass:true,allMeasurementsPass:true,premium:{state:"PASS",evaluations:categories.flatMap((category)=>(["mobile","desktop"] as const).map((viewport)=>({card:{category,viewport,schema:"website-design-compiler/design-quality-eval/v3",overall:"PASS"},decision:{overall:"PREMIUM_PASS"}})))}};
const binding={schema:"website-design-compiler/issue-36-evidence-binding/v2",overall:"PASS",git:{sha,ref,tree},evaluator:{path:"artifacts/v3/design-quality/design-quality-eval-receipt.json",sha256:digest,schema:"website-design-compiler/design-quality-eval-receipt/v3",result:"PASS"},inventory:{state:"PASS",expected:12,observed:12},negativeControls:{state:"PASS"},residual:{premiumEvaluation:"PASS"}};
const arena={overall:"PASS",git:{sha,ref},v2Metrics:{designQuality:{state:"PASS",categoryCount:6,mobileCount:6,desktopCount:6}},metricEvidence:{designQualityPremium:["artifacts/v3/design-quality/design-quality-eval-receipt.json"]},evidence:{designQuality:"artifacts/v3/design-quality/design-quality-eval-receipt.json"}};

test("premium release requires exact-head v3 premium, calibration, binding and Arena evidence",()=>{
  const pass=evaluateIssue36PremiumRelease(evaluator,binding,arena,{sha,ref,tree},digest);
  assert.equal(pass.overall,"PASS");
  assert.deepEqual(pass.failures,[]);
  const stale=structuredClone(evaluator);stale.git.sha="d".repeat(40);
  assert.ok(evaluateIssue36PremiumRelease(stale,binding,arena,{sha,ref,tree},digest).failures.includes("evaluator:lineage"));
  const missing=structuredClone(evaluator);missing.premium.evaluations.pop();
  assert.ok(evaluateIssue36PremiumRelease(missing,binding,arena,{sha,ref,tree},digest).failures.includes("evaluator:coverage"));
  const premiumFail=structuredClone(evaluator);premiumFail.premium.state="FAIL";
  assert.ok(evaluateIssue36PremiumRelease(premiumFail,binding,arena,{sha,ref,tree},digest).failures.includes("evaluator:premium"));
  const substitute=structuredClone(binding);substitute.evaluator.sha256="e".repeat(64);
  assert.ok(evaluateIssue36PremiumRelease(evaluator,substitute,arena,{sha,ref,tree},digest).failures.includes("binding:evaluator-substitute"));
});

test("premium release schema keeps exact paths and identities",async()=>{
  const receipt={schema:"website-design-compiler/issue-36-premium-release/v1",overall:"FAIL",git:{sha,ref,tree},evidence:{evaluator:{path:"artifacts/v3/design-quality/design-quality-eval-receipt.json",sha256:digest,schema:"website-design-compiler/design-quality-eval-receipt/v3",state:"FAIL",sameLineage:"PASS"},binding:{path:"artifacts/handoff/issue-36-evidence-binding.json",sha256:digest,schema:"website-design-compiler/issue-36-evidence-binding/v2",state:"FAIL",sameLineage:"PASS"},arena:{path:"artifacts/arena/arena-score.json",sha256:digest,state:"FAIL",sameLineage:"PASS"}},gates:{evaluator:"FAIL",premium:"FAIL",coverage:"FAIL",calibration:"FAIL",binding:"FAIL",arenaDesignQualityPremium:"FAIL",digestChain:"FAIL",thresholds:"PASS"},coverage:{categories:6,mobile:6,desktop:5,evaluations:11},thresholds:{premiumQuality:78,originalitySimilarity:.82},failures:["evaluator:coverage"]};
  await validateAgainstSchema(receipt,"issue-36-premium-release.schema.json");
  const substituted=structuredClone(receipt) as Record<string,any>;substituted.evidence.evaluator.path="artifacts/v2/design-quality/design-quality-eval-receipt.json";
  await assert.rejects(validateAgainstSchema(substituted,"issue-36-premium-release.schema.json"),/must be equal to constant/);
});
