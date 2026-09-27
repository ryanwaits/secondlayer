---
"@secondlayer/sdk": minor
---

`index.pox5.events` gets `consume()`, matching `events`, `contractCalls`, and `sbtc.events`: checkpointed paging, cursor saving, reorg rollback, and retries, instead of hand-rolling `list`/`walk` into a loop.
