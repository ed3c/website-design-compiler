# Storybook visual-review admission

The screenshot review file is evidence content, not its own trust anchor. It cannot promote the Storybook gate to `PASS` merely by declaring a different reviewer identity or context.

An admission requires both inputs:

1. `fixtures/storybook/visual-review-admission.json`, validated by `schemas/storybook-visual-review-admission-v1.schema.json`, must bind the exact review receipt bytes, Git subject, reviewed source hash, screenshot-set hash, and reviewer identity/context.
2. `WDC_STORYBOOK_VISUAL_ADMISSION_SHA256` must be supplied through an external Human/orchestrator trust channel and equal the admission file's SHA-256. Do not hard-code that value in the repository or derive it inside the validator invocation.

If either input is absent or mismatched, `pnpm storybook:receipt` records the boundary and returns `FAIL`. A fresh review file, a self-declared context, or unique long prose cannot substitute for admission.
