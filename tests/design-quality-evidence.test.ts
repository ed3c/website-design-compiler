import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { evaluateDesignQuality } from "../src/design-quality-eval.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding } from "../src/design-quality-evidence.js";

const gitSha="0123456789abcdef0123456789abcdef01234567";
const hash="a".repeat(64);

test("structural PASS without screenshot-bound evidence cannot become PREMIUM_PASS",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const card=evaluateDesignQuality(graph,"desktop",60);
  assert.equal(card.overall,"PASS");
  const decision=decidePremiumQuality(card,null,gitSha,60);
  assert.equal(decision.structuralState,"PASS");
  assert.equal(decision.evidenceState,"FAIL");
  assert.equal(decision.overall,"FAIL");
  assert.ok(decision.reasons.includes("screenshot:ABSENT"));
});

test("exact graph token screenshot and git bindings permit premium decision only above threshold",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);
  const card=evaluateDesignQuality(graph,"desktop",60);
  const binding:DesignQualityEvidenceBinding={schema:"website-design-compiler/design-quality-evidence/v2",category:card.category,viewport:card.viewport,pageGraphSha256:hash,designTokensSha256:"b".repeat(64),screenshotSha256:"c".repeat(64),gitSha,graphSignature:card.graphSignature,screenshotPath:"artifacts/design-quality/screenshots/b2b-product-desktop.png"};
  const decision=decidePremiumQuality(card,binding,gitSha,60);
  assert.equal(decision.evidenceState,"PASS");
  assert.equal(decision.overall,"PREMIUM_PASS");
});

test("mismatched git or graph identity fails closed even with valid-looking hashes",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[1]!);
  const card=evaluateDesignQuality(graph,"mobile",50);
  const binding:DesignQualityEvidenceBinding={schema:"website-design-compiler/design-quality-evidence/v2",category:card.category,viewport:card.viewport,pageGraphSha256:hash,designTokensSha256:hash,screenshotSha256:hash,gitSha:"f".repeat(40),graphSignature:"wrong",screenshotPath:"artifacts/design-quality/screenshots/editorial-mobile.png"};
  const decision=decidePremiumQuality(card,binding,gitSha,50);
  assert.equal(decision.bindings.gitSha,"MISMATCH");
  assert.equal(decision.bindings.graphSignature,"MISMATCH");
  assert.equal(decision.overall,"FAIL");
});

test("unsafe or missing screenshot identity is not evidence",()=>{
  const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[2]!);
  const card=evaluateDesignQuality(graph,"desktop",50);
  const binding:DesignQualityEvidenceBinding={schema:"website-design-compiler/design-quality-evidence/v2",category:card.category,viewport:card.viewport,pageGraphSha256:hash,designTokensSha256:hash,screenshotSha256:"not-a-hash",gitSha,graphSignature:card.graphSignature,screenshotPath:"../outside.png"};
  const decision=decidePremiumQuality(card,binding,gitSha,50);
  assert.equal(decision.bindings.screenshot,"ABSENT");
  assert.equal(decision.overall,"FAIL");
});
