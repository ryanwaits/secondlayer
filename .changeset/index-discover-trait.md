---
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
---

Index discovery + trait filtering for agents. Add `Index.discover()` (GET `/v1/index`) and an `index_discover` MCP tool exposing the live vocabulary — per-event-type columns, allowed/equality filters, and which types accept `trait` — wired into the context resource's discover-first hint. Add a `trait` filter (e.g. `sip-010`) to `index.events` / `index.contractCalls` SDK params and the `index_events` / `index_contract_calls` MCP tools, so `contracts_find → trait → one Index query` composes. (Trait runs through the `/events` and `/contract-calls` routes, which resolve it server-side; the `index_ft_transfers`/`index_nft_transfers` aliases don't take `trait` — use `index_events` with `event_type` for trait-scoped transfers.)
