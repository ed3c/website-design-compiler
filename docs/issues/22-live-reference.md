# Issue 22: opt-in live reference verification

The production URL adapter and the live receipt contract are locally exercised with deterministic injected transports. Live third-party availability remains `NOT_EXERCISED` because issue 22 does not nominate two stable public HTTPS targets and this repository must not silently choose external sites.

After a human admits two distinct public targets and outbound network access, run the separate live lane from the repository root:

```sh
pnpm exec tsx scripts/live-reference-receipt.ts https://first-public-target.example/ https://second-public-target.example/
```

The command writes `artifacts/live-reference/live-reference-receipt.json`. It exits nonzero unless both targets produce a schema-valid `PASS` through the production pinned-network adapter. Availability failures remain `NOT_EXERCISED`; policy or compiler/content contract failures remain `FAIL`.

This command is intentionally absent from deterministic PR CI and from the release gate. Promoting it to release policy requires a separate explicit configuration decision backed by named targets, an outbound-network Human Admit, and a reviewed retention/publication policy for the receipt.
