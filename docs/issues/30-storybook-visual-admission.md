# Storybook visual-golden admission

The active runtime has one admission contract. A GitHub Actions run produces a
`storybook-golden-candidate/v1` document and exactly 90 Ubuntu screenshots. A
separate reviewer inspects those exact bytes and writes a
`storybook-golden-review/v1` document. Outside GitHub Actions, the promotion
command embeds both documents in `fixtures/storybook/visual-goldens.json`.

The resulting file must validate against
`schemas/storybook-visual-goldens.schema.json` as
`website-design-compiler/storybook-visual-goldens/v3`.

Admission additionally requires the repository variable
`WDC_STORYBOOK_VISUAL_GOLDENS_SHA256` to equal the exact byte SHA-256 of that
manifest. The variable is an external Human/administrator trust input: do not
hard-code it in the repository or derive it inside the validator invocation.

The candidate must bind a durable branch-head commit rather than a synthetic
`refs/pull/*/merge` commit. It must be an ancestor of the evaluated head, and no
reviewed source may have changed between the candidate and that head.

If the manifest, external hash, candidate ancestry, 90 screenshot hashes, or
review receipt is absent or mismatched, `pnpm storybook:receipt` records the
boundary and returns `FAIL`. The historical
`WDC_STORYBOOK_VISUAL_ADMISSION_SHA256`/`visual-review-admission/v1` path is not
an alias and must not be configured.
