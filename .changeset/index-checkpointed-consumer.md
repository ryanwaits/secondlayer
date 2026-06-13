---
"@secondlayer/sdk": minor
---

Index checkpointed consumer: `index.events.consume()` and `index.contractCalls.consume()` — onBatch cursor commit, automatic reorg rewind to the fork point, `finalizedOnly` gated by `tip.finalized_height`, `fromHeight` backfill start; `IndexTip` now carries `finalized_height`
