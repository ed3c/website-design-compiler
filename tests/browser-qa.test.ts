import assert from "node:assert/strict";
import test from "node:test";
import { collectBrowserProjectResults } from "../src/browser-qa.js";

test("collects project status from Playwright test-level projectName and nested results", () => {
  const report = {
    suites: [
      {
        specs: [
          {
            tests: [
              {
                projectName: "desktop-chromium",
                status: "expected",
                expectedStatus: "passed",
                results: [{ status: "passed", retry: 0 }]
              },
              {
                projectName: "mobile-chromium",
                status: "expected",
                expectedStatus: "passed",
                results: [{ status: "passed", retry: 0 }]
              }
            ]
          }
        ]
      }
    ],
    stats: { expected: 2, unexpected: 0 }
  };

  assert.deepEqual(collectBrowserProjectResults(report), [
    { projectName: "desktop-chromium", status: "passed" },
    { projectName: "mobile-chromium", status: "passed" }
  ]);
});

test("failed attempt dominates a project result", () => {
  const report = {
    suites: [{ specs: [{ tests: [{ projectName: "desktop-chromium", results: [{ status: "passed" }, { status: "failed" }] }] }] }]
  };

  assert.deepEqual(collectBrowserProjectResults(report), [
    { projectName: "desktop-chromium", status: "failed" }
  ]);
});
