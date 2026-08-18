# Generated-page browser admission

Premium quality may consume generated-page screenshots and visual observations only after an authority outside the Playwright producer admits the exact evidence set.

The authority reviews the browser producer and release verifier files listed by `GENERATED_PAGE_BROWSER_TRUST_SOURCE_PATHS`, the exact Git subject, the generated-page receipt, all screenshot hashes, and all observation hashes. It then writes `fixtures/generated-pages/browser-admission.json` using `website-design-compiler/generated-page-browser-admission/v1`.

The exact admission-file SHA-256 must arrive through the protected repository variable `WDC_GENERATED_PAGE_BROWSER_ADMISSION_SHA256`. The producer must not write or derive that value. Missing admission, same-change producer or verifier drift, non-canonical viewport dimensions, or artifact drift keeps premium release evidence at `FAIL`.
