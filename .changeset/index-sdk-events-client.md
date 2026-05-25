---
"@secondlayer/sdk": minor
---

`Index` client gains `events.list/walk` — generic decoded events keyed by `event_type`, returning a discriminated `IndexEvent` union (transfers, mints, burns, and `print`) — and `contractCalls.list/walk` for decoded contract-call transactions, alongside the existing `ftTransfers`/`nftTransfers`. Cursors are opaque and per-endpoint (events use `block_height:event_index`, contract-calls use `block_height:tx_index`).
