import assert from "node:assert/strict";
import test from "node:test";
import {
  hashScreenshotSet,
  validateIndependentVisualReview,
  type IndependentVisualReview
} from "../src/storybook-visual-review.js";

const screenshots = {
  "storybook-desktop--example.png": "a".repeat(64),
  "storybook-mobile--example.png": "b".repeat(64)
};

function review(overrides: Partial<IndependentVisualReview> = {}): IndependentVisualReview {
  return {
    schema: "website-design-compiler/storybook-visual-review/v2",
    overall: "PASS",
    subject: {
      commit: "c".repeat(40),
      tree: "d".repeat(40),
      sourceFilesSha256: "e".repeat(64),
      screenshotSetSha256: hashScreenshotSet(screenshots),
      authorContextId: "/root"
    },
    reviewer: {
      kind: "agent",
      identity: "fresh visual reviewer",
      runtime: "codex-subagent",
      contextId: "/root/storybook_visual_admit_v2",
      independence: "SEPARATE_CONTEXT",
      wroteSubject: false,
      startedAt: "2026-08-18T14:00:00.000Z",
      completedAt: "2026-08-18T14:10:00.000Z"
    },
    screenshots: Object.entries(screenshots).map(([name, sha256]) => ({
      name,
      sha256,
      verdict: "PASS",
      observations: [`${name} renders without clipping and preserves all primary information.`]
    })),
    ...overrides
  };
}

const expected = {
  subjectCommit: "c".repeat(40),
  subjectTree: "d".repeat(40),
  sourceFilesSha256: "e".repeat(64),
  screenshotHashes: screenshots
};

test("an independently bound visual review admits the exact screenshot set", () => {
  assert.deepEqual(validateIndependentVisualReview(review(), expected), []);
});

test("same-context self review fails closed", () => {
  const value = review({ reviewer: { ...review().reviewer, contextId: "/root" } });
  assert.match(validateIndependentVisualReview(value, expected).join("\n"), /reviewer context must differ/);
});

test("a reviewer who wrote the subject cannot admit it", () => {
  const value = review({ reviewer: { ...review().reviewer, wroteSubject: true } });
  assert.match(validateIndependentVisualReview(value, expected).join("\n"), /must not have written/);
});

test("subject, source, and screenshot drift all fail closed", () => {
  const value = review({
    subject: {
      ...review().subject,
      commit: "f".repeat(40),
      sourceFilesSha256: "0".repeat(64),
      screenshotSetSha256: "1".repeat(64)
    }
  });
  const errors = validateIndependentVisualReview(value, expected).join("\n");
  assert.match(errors, /subject commit/);
  assert.match(errors, /source files/);
  assert.match(errors, /screenshot set/);
});

test("one failed screenshot makes an overall PASS review invalid", () => {
  const [first, ...rest] = review().screenshots;
  const value = review({ screenshots: [{ ...first!, verdict: "FAIL" }, ...rest] });
  assert.match(validateIndependentVisualReview(value, expected).join("\n"), /overall PASS contradicts/);
});

test("placeholder or duplicated observations are not review evidence", () => {
  const value = review({
    screenshots: review().screenshots.map((entry) => ({ ...entry, observations: ["looks fine"] }))
  });
  const errors = validateIndependentVisualReview(value, expected).join("\n");
  assert.match(errors, /too short/);
  assert.match(errors, /duplicated/);
});
