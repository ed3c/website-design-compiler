<!-- BEGIN DOMAIN DECOUPLING BOOTSTRAP -->
## Cross-repository binding flow

```text
skills-shared immutable subject
→ `.agents/control-plane/source.json`
→ consumer requirements
→ generated thin binding
→ consumer runtime/acceptance
→ consumer-owned receipt
```

A sibling checkout, symlink, mutable branch, package presence, or provider health is not a release identity.
<!-- END DOMAIN DECOUPLING BOOTSTRAP -->
