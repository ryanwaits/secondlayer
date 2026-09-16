---
"@secondlayer/shared": minor
"@secondlayer/indexer": minor
"@secondlayer/api": minor
"@secondlayer/stacks": minor
"@secondlayer/subgraphs": minor
"@secondlayer/sdk": patch
---

Persist opt-in node `vm_events` on `vm_event_index`. Index/Streams/subgraphs/webhooks take the five stored types. Classic Streams 1.0 cursor unchanged. Inner calls are `nested_contract_call`.

Clock isolation: Streams cache keys include the resolved clock; VM Index reads clamp to the source tip; empty VM scans return the bounded empty-range sentinel; VM pages overlap reorgs by height; fork flip-back reconstructs node-shaped vm_events. Typed subgraph VM payloads preserve raw hex. SDK infers VM row types and forwards `txId`. OpenAPI declares the new Index filters.

Re-mined txs last-writer-wins on persist columns. Archive the old transaction (block hash + execution fields) before moving ownership. VM deletes are height-only. `/blocks` and `/transactions` windows follow the ingest tip; envelope `block_height` stays decoded. VM HTTP subgraphs read that ingest tip. Classic `toStreamsParams()` stays Streams 1.0 vocab; VM members use `{ clock: "vm" }`. Bounded VM reads refuse inverted ranges. SDK `events.list` classic overloads exclude `clock: "vm"`; an unresolved clock returns the wire union. OpenAPI `tx_id` is VM-only.

VM Index and Streams resume pages report checkpoint reorgs when matching events disappear, the next match is later, or the source tip rewinds. Rollbacks use block heights, independently of the classic reorg ordinal.
