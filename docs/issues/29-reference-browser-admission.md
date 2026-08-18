# Reference browser admission

Originality may consume Playwright-computed reference fingerprints only after an authority outside the producer supplies a matching admission.

The authority reviews the producer, verifier, workflow, and receipt schemas listed by `REFERENCE_BROWSER_TRUST_SOURCE_PATHS`, then writes `fixtures/reference-browser/browser-admission.json` using `website-design-compiler/reference-browser-admission/v1`. The admission binds the aggregate source SHA-256 and the deterministic captured reference artifact SHA-256. Its exact bytes SHA-256 must be supplied through the protected repository variable `WDC_REFERENCE_BROWSER_ADMISSION_SHA256`.

The producer cannot write or derive that repository variable. A missing admission, a same-PR source change, a different captured fixture, or a mismatched external hash keeps originality evidence fail closed. Browser screenshots must independently pass PNG chunk checksums, zlib scanline decoding, viewport bounds, and receipt/evidence byte hashes.
