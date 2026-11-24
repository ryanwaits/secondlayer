---
"@secondlayer/subgraphs": patch
---

Webhook delivery drops auth headers on cross-origin redirects, refuses https to http redirects, and reads at most 8 KiB of a response. A second reorg at the same height now emits its own rollback. Subgraph reorg cleanup of factory addresses and violations runs in the rewind transaction. Paused-webhook outbox release only touches rows this emitter still holds.
