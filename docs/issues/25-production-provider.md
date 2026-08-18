# Issue 25: production provider evidence boundary

The deterministic mock and the production provider are separate gates. A mock `PASS` never makes a production provider release-eligible.

## Current state

- Real image-provider execution: `NOT_EXERCISED`. No protected provider bundle, request secret, provider credential, or signed Human admission is present in the repository.
- Repository-wide rights: `FAIL` until the distributed `sharp-libvips`, `caniuse-lite`, and `gsap` subjects receive valid, scoped Human/legal decisions.
- Pinned video candidate `stabilityai/stable-video-diffusion-img2vid-xt-1-1-tensorrt@32eaa3e7d521d402740f134d3390c9697fb99f3e`: model weights are `DENY`; output and service terms are `UNKNOWN`.
- Pinned 3D candidate `facebook/vfusion3d@0aeeaaca12806a10d7ba326992f84b0922f41188`: model weights are `DENY`; output and service terms are `UNKNOWN`.

The two rejected candidates run through `routeProductionMediaGeneration`. Their formal negative control must return `DENIED`, remain `NOT_EXERCISED`, and make zero credential-bearing transport calls.

## External admission

A candidate rejection receipt can become `PASS` only when both protected repository variables match the exact frozen subject:

- `WDC_PRODUCTION_RIGHTS_EVIDENCE_SHA256`: SHA-256 of the exact bytes of `rights-production-evidence.json`, after Human/legal review of the pinned primary-source snapshots and their classifications.
- `WDC_PRODUCTION_CANDIDATE_TRUSTED_TREE`: the exact 40-character Git tree of the reviewed commit. This binds the policy, verifier, schemas, workflow, and source evidence together; changing any tracked file requires a new admission.

If both variables are absent, the receipt is `NOT_EXERCISED`. Partial, malformed, or mismatched admission fails closed. The protected digest proves review of a snapshot; it does not claim that CI re-downloaded the remote sources or supplied legal advice.

## Production release readback

`production-provider-status/v3` requires the exact candidate-rejection artifact alongside the execution input, execution receipt, and generated asset. Commercial release readback rejects a missing file, byte/hash drift, symlink escape, wrong Git subject, changed policy or rights evidence, non-PASS external admission, or a reconstructed formal-route mismatch.

The remaining Human sequence is intentionally outside the repository:

1. Resolve or explicitly reject the three distributed repository-rights subjects.
2. Review the frozen rights snapshot and Git tree; set the two protected candidate variables.
3. Select one exact image provider/model revision whose model, generated-output, and hosted-service subjects are all `ALLOW` in the canonical rights receipt.
4. Provision the protected provider bundle, request-signing secret, provider credential, budget/quota admission, and trusted Ed25519 authority.
5. Execute on the exact `main` push and read back the persisted asset, provider request ID, provenance, status v3, and commercial release receipt.

Until all five steps have runtime receipts, issue 25 must remain open.
