---
"@secondlayer/subgraphs": minor
---

Add trait-scoped subgraph sources. A source can target a SIP standard instead of a fixed contract — `{ type: "ft_transfer", trait: "sip-010" }` indexes events across every contract the registry classifies as that standard, including ones deployed later. Token filters match by the asset-identifier's contract; contract_call/print match by contract id; trait composes with other filters. Resolution is as-of-block, so a reindex backfills a contract's full history even if it was classified after deploy. Requires the contract registry to be populated.
