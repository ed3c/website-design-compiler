# license-provenance

## Purpose
Fail closed on dependencies, models, generated assets, fonts, references, and hosted services whose commercial-use or provenance status is not established.

## Inputs
- `policies/licenses.yaml`
- dependency manifests and lockfiles
- asset manifest
- model/provider manifest
- generated-output terms when applicable

## Procedure
1. Resolve exact package, model, asset, or service version/commit.
2. Record source-code license separately from model-weight license, generated-output terms, hosted-service terms, and attribution obligations.
3. Classify each item against `policies/licenses.yaml` as allow, review, or deny.
4. Treat missing, ambiguous, geographic, MAU-triggered, non-commercial, research-only, or incompatible terms according to policy without inference.
5. Hash distributed/generated assets and bind provenance to the tested commit.
6. Emit a machine-readable receipt and unresolved review queue.

## Outputs
- `artifacts/provenance/asset-manifest.json`
- `artifacts/receipts/license-receipt.json`

## Evidence states
`PASS | FAIL | ABSENT | NOT_IMPLEMENTED | NOT_EXERCISED | SKIPPED_BY_POLICY`

## Pass rule
PASS requires every product-core dependency and distributed asset to be in an allowed state or to have an explicit reviewed approval recorded outside this Skill. Unknown status cannot be promoted to PASS.

## Stop conditions
FAIL on denied licenses or terms.
ABSENT when required license/provenance evidence cannot be located.
Do not substitute repository popularity, vendor identity, or an adjacent code license for missing rights evidence.
