import test from "node:test";
import assert from "node:assert/strict";
import { compileAllSectionPageFixtures } from "../src/section-page-fixtures.js";
import { compileCompletePageGraph } from "../src/complete-page-graph.js";
import { evaluateDesignQuality } from "../src/design-quality-eval.js";
import { decidePremiumQuality, type DesignQualityEvidenceBinding, type ExpectedDesignQualityEvidence } from "../src/design-quality-evidence.js";

const hash="a".repeat(64);const otherHash="b".repeat(64);const gitSha="c".repeat(40);
function fixture(){const graph=compileCompletePageGraph(compileAllSectionPageFixtures()[0]!);const visual={schema:"website-design-compiler/generated-page-visual-observation/v1" as const,category:graph.category,project:"desktop-chromium",viewport:{width:1440,height:1000},nodeCount:6,sectionKinds:graph.nodes.map((node)=>node.kind),typography:{families:["Inter"],headingToBodyRatio:2.4,distinctHeadingSizes:3},contrast:{minimumRatio:7,sampleCount:20},rhythm:{averageVerticalGap:48,distinctBackgrounds:3,sectionTransitions:4},ctaCount:3,clippedTextCount:0};const card=evaluateDesignQuality(graph,"desktop",50,[],[],0.82,visual);const expected:ExpectedDesignQualityEvidence={category:card.category,viewport:card.viewport,pageGraphSha256:hash,designTokensSha256:hash,screenshotSha256:hash,gitSha,graphSignature:card.graphSignature};const binding:DesignQualityEvidenceBinding={schema:"website-design-compiler/design-quality-evidence/v2",...expected,screenshotPath:"artifacts/generated-pages/screenshots/desktop-chromium--b2b-product.png"};return{card,expected,binding};}

test("exact evidence binding can produce premium pass",()=>{const {card,expected,binding}=fixture();const decision=decidePremiumQuality(card,binding,expected,50);assert.equal(decision.evidenceState,"PASS");assert.equal(decision.overall,"PREMIUM_PASS");});

test("well-formed but mismatched screenshot hash fails closed",()=>{const {card,expected,binding}=fixture();binding.screenshotSha256=otherHash;const decision=decidePremiumQuality(card,binding,expected,50);assert.equal(decision.bindings.screenshot,"MISMATCH");assert.equal(decision.overall,"FAIL");});

test("mismatched page graph tokens or git sha fail closed",()=>{const {card,expected,binding}=fixture();binding.pageGraphSha256=otherHash;binding.designTokensSha256=otherHash;binding.gitSha="d".repeat(40);const decision=decidePremiumQuality(card,binding,expected,50);assert.equal(decision.bindings.pageGraph,"MISMATCH");assert.equal(decision.bindings.designTokens,"MISMATCH");assert.equal(decision.bindings.gitSha,"MISMATCH");assert.equal(decision.overall,"FAIL");});

test("unsafe screenshot path is absent evidence",()=>{const {card,expected,binding}=fixture();binding.screenshotPath="../outside.png";const decision=decidePremiumQuality(card,binding,expected,50);assert.equal(decision.bindings.screenshot,"ABSENT");assert.equal(decision.overall,"FAIL");});
