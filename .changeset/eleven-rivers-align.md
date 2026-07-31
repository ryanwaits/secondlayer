---
"@secondlayer/sdk": minor
"@secondlayer/stacks": minor
"@secondlayer/cli": minor
---

Sprint of filter-surface convergence, without unifying what should not unify (see the new ADR, docs/internal/charter/index-vs-streams.md).

Aliases both directions: `/v1/streams/events` accepts `event_type=<single>` (folds into `types`), `/v1/index/events` accepts `types=<single>` — two or more values are refused naming the reason (Index pagination is keyed per event type). CLI mirrors: `sl streams events --event-type`, `sl index events --types`.

Streams filter parity: the top-level `consume()` iterator accepts the labelled `filters` map (the page-handler `events.consume` always did), and `replay()` narrows its LIVE TAIL with `types`/`notTypes`/`filters` — the dump phase stays all-type by design (block-partitioned parquet).

Top-level `types` now narrows at compile time: `list`/`stream`/`consume` with a literal `types: ["ft_transfer"]` return rows typed as exactly those union members, matching what labels and Index reads already did. `StreamsEventsEnvelope` and `StreamsBatch` are row-generic; `StreamsEventOfTypes` is exported.

`@secondlayer/stacks`: `factory` (dynamic address discovery — a router plus pools created after you deploy) is now part of the canonical filter vocabulary on `contract_call` and `print_event` members. `toSubgraphSource()` keeps it; every other projection throws naming it Subgraphs-only, so it can never silently widen or vanish. Deferred deliberately: `maxAmount` and `contractId` on ft/nft members await verification of the subscriptions delivery-side matcher — adding schema fields a matcher ignores would create silent no-op filters, the bug class this vocabulary exists to kill.
