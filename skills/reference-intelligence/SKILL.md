# reference-intelligence

## Purpose
Turn website references into evidence-backed design observations without cloning protected identity or inventing implementation details.

## Inputs
- product brief
- optional URLs, screenshots, video, source HTML, or asset lists
- repository-local design and originality policies

## Procedure
1. Record each reference with source, capture time, media type, and observable scope.
2. Separate facts from inference.
3. Extract layout, hierarchy, typography, surfaces, color roles, motion grammar, interaction states, media treatment, and responsive behavior.
4. Mark brand identity, copyrighted copy, logos, illustrations, trademarks, and distinctive assets as non-transferable unless the repository has explicit rights.
5. Produce an originality plan describing which design grammar may be learned, what must be transformed, and what must be replaced.
6. Hand off normalized observations to the selected art-direction skill.

## Outputs
- `artifacts/design/reference-manifest.json`
- `artifacts/design/reference-analysis.md`
- `artifacts/design/originality-plan.md`

## Stop conditions
Return `ABSENT` when no reference can be accessed and the brief requires one.
Return `FAIL` when the requested result requires copying protected brand/content rather than learning general design grammar.

## Evidence rule
A narrative description is not proof of visual parity or originality. Screenshot capture and later browser verification are separate runtime gates.
