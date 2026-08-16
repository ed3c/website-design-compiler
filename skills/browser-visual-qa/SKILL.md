# browser-visual-qa

## Purpose
Verify the built website in a real browser and emit reproducible visual/runtime evidence.

## Inputs
- built application or local preview URL
- viewport matrix
- interaction paths
- reduced-motion policy
- optional WebGL/static fallback requirements

## Procedure
1. Start or connect to the built application.
2. Execute smoke navigation and primary interaction paths.
3. Capture desktop, tablet, and mobile screenshots.
4. Exercise keyboard navigation and visible focus.
5. Exercise `prefers-reduced-motion`.
6. When WebGL/Canvas is non-essential, verify static or semantic fallback by disabling or failing the graphics path.
7. Record console errors and failed network requests.
8. Bind all evidence paths to the tested commit.

## Required states
Use only:
`PASS | FAIL | ABSENT | NOT_IMPLEMENTED | NOT_EXERCISED | SKIPPED_BY_POLICY`

## Pass rule
PASS requires executed browser evidence. Source inspection, screenshots from a different commit, or prose claims cannot produce PASS.

## Outputs
- `artifacts/qa/screenshots/`
- `artifacts/qa/traces/`
- `artifacts/qa/browser-qa.json`

## Stop conditions
FAIL when a primary route or action is broken, unexplained console errors occur, required viewport evidence is missing, or a required fallback fails.
