---
"@secondlayer/stacks": minor
---

New `@secondlayer/stacks/filters` subpath — the canonical chain-event filter vocabulary. One chain event was spelled five different ways across Index, Streams, Subgraphs, and Subscriptions (with three incompatible `minAmount` types among them); `on.*` is now the single spelling, projected explicitly to each surface:

```ts
import { on } from "@secondlayer/stacks/filters";

const usdc = on.ftTransfer({ assetIdentifier: USDC, minAmount: 1_000_000n });

sl.index.events.list(usdc.toIndexParams({ limit: 100 }));          // pull
sl.streams.events.consume({ ...usdc.toStreamsParams(), onBatch }); // stream
sl.subscriptions.create({ name, url, triggers: [usdc.toChainTrigger()] }); // push
defineSubgraph({ sources: { usdc: usdc.toSubgraphSource() } });    // index
```

- A surface a member can't reach is a **missing method** (compile error): the five `sbtc_*` types have only `toChainTrigger()`, `contract_call` has `toContractCallsParams()` instead of `toIndexParams()`.
- A field a surface can't express **throws at projection time** (`trait` on Streams, `minAmount` on Index reads, wildcards outside Subscriptions) — never a silent zero-row or over-wide match.
- Amounts are `bigint` in the vocabulary and stringify at exactly one place (`toChainTrigger()`), so a spread bigint can never reach `JSON.stringify`.
- Filters validate at construction: a contract id passed as an asset identifier, or a malformed principal, fails immediately with a message naming the fix.
- `prints`/`abi` literals are preserved through `toSubgraphSource()`, so `defineSubgraph` handler narrowing survives.
- `DECODED_EVENT_TYPES` now lives here (the leaf of the dependency graph); `@secondlayer/shared` re-exports it unchanged. `isPrincipal`/`assertPrincipalish` and friends are exported for standalone use.
- The older snake_case row-filter factories under the root `on` export are deprecated in favor of this module and will be removed in the next major.

Round-trip property tests gate this in CI: every member with every field set must satisfy the server's strict trigger schema, and every production subgraph source must survive `toSubgraphSource(fromSubgraphSource(f))` unchanged.
