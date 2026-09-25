---
"@secondlayer/subgraphs": minor
---

`BlockSource.getTip()` takes an optional `{ wait, knownHeight }`, used by the chain-trigger evaluator to long-poll the Index tip instead of sleeping a fixed 5s between ticks when it's caught up. A source with no long-poll notion (the Postgres tap) ignores it. `buildChainBlockSource()` also takes an optional `IndexHttpClient` to reuse across calls instead of building a fresh one each time.
