import assert from "node:assert/strict";
import test from "node:test";
import { calibratedVisualSimilarity } from "../src/design-quality-calibration.js";
import { qualityObservation } from "./helpers/design-quality.js";

test("visual similarity calibration keeps identical evidence at one",()=>{
  const observation=qualityObservation("calibration","desktop");
  assert.equal(calibratedVisualSimilarity(observation,structuredClone(observation)),1);
});

test("visual similarity calibration detects ordered composition changes",()=>{
  const baseline=qualityObservation("calibration","desktop");
  const reordered=structuredClone(baseline);
  reordered.computed.layouts.reverse();
  reordered.computed.renderedColumns.reverse();
  reordered.computed.sectionHeights.reverse();
  reordered.computed.sectionWidths.reverse();
  assert.ok(calibratedVisualSimilarity(baseline,reordered)<.9);
});

test("visual similarity calibration treats palette-only change as finite but not identical",()=>{
  const baseline=qualityObservation("calibration","desktop");
  const palette=structuredClone(baseline);
  palette.computed.cssTokens["--wdc-color-background"]="oklch(.92 .04 120)";
  palette.computed.cssTokens["--wdc-color-surface"]="oklch(.84 .08 120)";
  palette.computed.cssTokens["--wdc-color-accent"]="oklch(.38 .18 140)";
  const similarity=calibratedVisualSimilarity(baseline,palette);
  assert.ok(similarity>.5&&similarity<1);
});

test("visual similarity calibration keeps a distant control below release threshold",()=>{
  const baseline=qualityObservation("calibration","desktop");
  const distant=qualityObservation("distant","desktop",true);
  assert.ok(calibratedVisualSimilarity(baseline,distant)<.82);
});
