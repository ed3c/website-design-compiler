# Generated-page browser admission

Premium quality may consume generated-page screenshots and visual observations only after an authority outside the Playwright producer admits the exact evidence set.

The authority reviews the browser producer and release verifier files listed by `GENERATED_PAGE_BROWSER_TRUST_SOURCE_PATHS`, the exact Git subject, the generated-page receipt, all screenshot hashes, and all observation hashes. The CI evidence artifact must therefore include both `artifacts/generated-pages/` and `artifacts/design-quality-browser/`. The authority then writes a `website-design-compiler/generated-page-browser-admission/v1` document outside the producer workflow.

The canonical one-line Base64 admission bytes arrive through the protected secret `WDC_GENERATED_PAGE_BROWSER_ADMISSION_BASE64`; their exact byte SHA-256 arrives independently through the protected repository variable `WDC_GENERATED_PAGE_BROWSER_ADMISSION_SHA256`. The active runtime does not read a tracked `fixtures/generated-pages/browser-admission.json` file. The producer must not write or derive either trust value. Missing admission, same-change producer or verifier drift, non-canonical viewport dimensions, or artifact drift keeps premium release evidence at `FAIL`.
