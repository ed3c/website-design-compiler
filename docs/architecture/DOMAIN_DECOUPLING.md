<!-- BEGIN DOMAIN DECOUPLING BOOTSTRAP -->
# Domain Decoupling Contract

Document ID: `DOMAIN-DECOUPLING-V1`  
Document Role: `CONSUMER_BINDING`  
Repository Plane: `INTEGRATION_ACCEPTANCE`

```text
portable shared core → immutable consumer binding → trigger-selected consumer adapter
→ consumer assertions → consumer-owned receipt
```

```text
ConsumerConstraints       ⊇ SharedCoreConstraints
ConsumerRequiredEvidence  ⊇ SharedRequiredEvidence
ConsumerAllowedEffects    ⊆ SharedAllowedEffects
ConsumerAuthority         ⊆ SharedMaximumAuthority
```

Domain-specific learning stays here. Generic reusable law is proposed upstream and adopted only through a new immutable binding.
<!-- END DOMAIN DECOUPLING BOOTSTRAP -->
