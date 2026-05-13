---
"@secondlayer/shared": patch
"@secondlayer/api": patch
---

fix subgraph delete 500-ing mid-reindex. Previously the route set `cancel_requested: true` and immediately ran `DROP SCHEMA ... CASCADE`, which blocked behind the live reindex transaction until the API socket timed out → generic 500. Adds `waitForSubgraphOperationsClear` (polls until active ops drain or 30 s timeout) and calls it after requesting cancel. The processor observes `cancel_requested` at batch boundaries (typically <5 s) and releases its row + advisory locks; DROP SCHEMA then proceeds cleanly. If the timeout elapses, the route logs a warning and proceeds anyway — preserves current behavior for the pathological case.
