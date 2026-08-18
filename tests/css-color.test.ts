import assert from "node:assert/strict";
import test from "node:test";
import { cssContrastRatio,parseCssColor } from "../src/css-color.js";

test("CSS color evidence parses browser RGB, sRGB and OKLCH serializations",()=>{
  assert.deepEqual(parseCssColor("rgb(255, 0, 127)"),{red:1,green:0,blue:127/255,alpha:1});
  assert.deepEqual(parseCssColor("color(srgb 0.2 0.3 0.4 / 0.5)"),{red:.2,green:.3,blue:.4,alpha:.5});
  const white=parseCssColor("oklch(1 0 0)");
  assert.ok(white&&white.red>.999&&white.green>.999&&white.blue>.999);
});

test("CSS contrast evidence composites transparent ancestor backgrounds",()=>{
  const ratio=cssContrastRatio("oklch(0 0 0)",["rgba(0, 0, 0, 0)","oklch(1 0 0)"]);
  assert.equal(ratio,21);
  assert.equal(cssContrastRatio("not-a-color",["white"]),null);
});
