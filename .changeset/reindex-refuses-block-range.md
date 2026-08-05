---
"@secondlayer/subgraphs": minor
"@secondlayer/cli": minor
---

Reindex is now always whole-subgraph and refuses a block range.

A reindex drops the subgraph's schema unconditionally, so its walk range was
also the only data that survived it: a narrow range did not scope the work, it
rebuilt that range and permanently discarded everything outside it — while the
subgraph went straight back to reporting `active` at chain tip, with no gap rows
and no error.

`reindexSubgraph` now resolves its range solely from the subgraph's start block
and the chain tip. `ReindexOptions.fromBlock`/`toBlock` are replaced by
`startBlockFloor`, a plan-policy floor that can only raise the start block and
never bounds the end. `sl subgraphs reindex` drops `--from-block`/`--to-block`,
and the API returns `400 REINDEX_RANGE_NOT_SUPPORTED` for a request carrying
either. Use `backfill` for ranged, additive work — it keeps its range.
