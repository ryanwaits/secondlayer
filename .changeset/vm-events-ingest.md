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

Re-mined txs last-writer-wins on persist columns. VM deletes are height-only. `/blocks` and `/transactions` windows follow the ingest tip; envelope `block_height` stays decoded. VM HTTP subgraphs read that ingest tip. `on.mapSet().toStreamsParams()` is `{ clock: "vm" }`. OpenAPI `tx_id` is VM-only.
