---
"@secondlayer/subgraphs": patch
---

fresh reindex resets the subgraph cursor with its schema drop — a stale cursor from a prior halted/cancelled run made the replay guard silently skip the entire history prefix (the sbtc-balances CHECK halt at block 1913668)
