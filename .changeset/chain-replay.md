---
"@secondlayer/subgraphs": patch
---

Support replay/catch-up for chain subscriptions. Replay previously threw for `kind=chain` because it scanned a subgraph's processed table, which chain subs don't have — so a chain receiver that was down past the outbox retry window permanently lost events. Replay now re-runs the pure trigger matcher over the requested canonical block range (reloading blocks off the public Index/Streams clock) and emits fresh apply rows with `is_replay=true` and replay-namespaced dedup keys, so missed deliveries are re-sent without colliding with the original live rows and re-running the same range stays idempotent. Replay never advances `trigger_evaluator_state` — it's historical and must not move the live forward cursor. `emitChainOutbox` now returns the net-inserted count so callers tally genuinely new deliveries.
