---
"@secondlayer/indexer": patch
---

fix(bns): reduce streams consume batch from 500 → 100

The streams print-event query uses a jsonb predicate on `data->>'contract_identifier'` that lacks an index. At limit=500 over a multi-thousand-block backfill window the query takes >5s and Bun's fetch closes the socket before the response arrives. limit=100 returns in ~2s on prod and lets the decoder make steady forward progress while the underlying index work is queued.
