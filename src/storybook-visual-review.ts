import { createHash } from "node:crypto";

export type VisualReviewState = "PASS" | "FAIL";

export interface IndependentVisualReview {
  schema: "website-design-compiler/storybook-visual-review/v2";
  overall: VisualReviewState;
  subject: {
    commit: string;
    tree: string;
    sourceFilesSha256: string;
    screenshotSetSha256: string;
    authorContextId: string;
  };
  reviewer: {
    kind: "agent" | "human";
    identity: string;
    runtime: string;
    contextId: string;
    independence: "SEPARATE_CONTEXT";
    wroteSubject: false | true;
    startedAt: string;
    completedAt: string;
  };
  screenshots: Array<{
    name: string;
    sha256: string;
    verdict: VisualReviewState;
    observations: string[];
  }>;
}

export interface ExpectedVisualReviewSubject {
  subjectCommit: string;
  subjectTree: string;
  sourceFilesSha256: string;
  screenshotHashes: Record<string, string>;
}

export function hashScreenshotSet(screenshots: Record<string, string>): string {
  const digest = createHash("sha256");
  for (const [name, sha256] of Object.entries(screenshots).sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(name);
    digest.update("\0");
    digest.update(sha256);
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function validateIndependentVisualReview(
  review: IndependentVisualReview,
  expected: ExpectedVisualReviewSubject
): string[] {
  const errors: string[] = [];
  if (review.subject.commit !== expected.subjectCommit) errors.push("review subject commit does not match the admitted commit");
  if (review.subject.tree !== expected.subjectTree) errors.push("review subject tree does not match the admitted tree");
  if (review.subject.sourceFilesSha256 !== expected.sourceFilesSha256) errors.push("review source files do not match the current reviewed source set");

  const expectedScreenshotSetSha256 = hashScreenshotSet(expected.screenshotHashes);
  if (review.subject.screenshotSetSha256 !== expectedScreenshotSetSha256) errors.push("review screenshot set does not match the current screenshot hashes");
  if (review.reviewer.contextId === review.subject.authorContextId) errors.push("reviewer context must differ from the subject author context");
  if (review.reviewer.independence !== "SEPARATE_CONTEXT") errors.push("visual review must run in a separate context");
  if (review.reviewer.wroteSubject) errors.push("independent reviewer must not have written the reviewed subject");

  const startedAt = Date.parse(review.reviewer.startedAt);
  const completedAt = Date.parse(review.reviewer.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    errors.push("visual review time window is invalid");
  }

  const names = review.screenshots.map((entry) => entry.name);
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicateNames.length > 0) errors.push(`visual review contains duplicated screenshot names: ${[...new Set(duplicateNames)].sort().join(", ")}`);
  const expectedNames = Object.keys(expected.screenshotHashes).sort();
  const actualNames = [...new Set(names)].sort();
  const missingNames = expectedNames.filter((name) => !actualNames.includes(name));
  const unexpectedNames = actualNames.filter((name) => !expectedNames.includes(name));
  if (missingNames.length > 0) errors.push(`visual review is missing screenshots: ${missingNames.join(", ")}`);
  if (unexpectedNames.length > 0) errors.push(`visual review includes unexpected screenshots: ${unexpectedNames.join(", ")}`);

  const observations: string[] = [];
  let hasFailedScreenshot = false;
  for (const entry of review.screenshots) {
    if (expected.screenshotHashes[entry.name] !== entry.sha256) errors.push(`visual review hash mismatch for ${entry.name}`);
    if (entry.verdict !== "PASS") hasFailedScreenshot = true;
    for (const observation of entry.observations) {
      const normalized = observation.trim();
      observations.push(normalized);
      if (normalized.length < 24) errors.push(`visual review observation is too short for ${entry.name}`);
    }
  }
  const duplicateObservations = observations.filter((observation, index) => observations.indexOf(observation) !== index);
  if (duplicateObservations.length > 0) errors.push("visual review contains duplicated observations instead of screenshot-specific evidence");
  if (review.overall === "PASS" && hasFailedScreenshot) errors.push("visual review overall PASS contradicts a failed screenshot verdict");
  if (review.overall === "FAIL" && !hasFailedScreenshot) errors.push("visual review overall FAIL requires a failed screenshot verdict");
  return errors;
}
