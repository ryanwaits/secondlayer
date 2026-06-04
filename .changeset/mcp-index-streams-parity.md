---
"@secondlayer/mcp": minor
---

Bring the MCP tool surface to parity with the SDK for Index and Streams. Adds Index tools for the remaining families — `index_canonical`, `index_blocks`, `index_transactions`, `index_stacking`, `index_mempool`, plus get-by-id (`index_block`, `index_transaction`, `index_mempool_tx`) — and Streams tools `streams_event_by_txid`, `streams_block_events`, `streams_reorgs`, and `streams_canonical`. Also fixes `streams_events` block-range filtering, which declared `fromBlock`/`toBlock` while the API expects `fromHeight`/`toHeight`, so those filters were silently dropped.
