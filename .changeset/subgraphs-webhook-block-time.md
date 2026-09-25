---
"@secondlayer/subgraphs": patch
---

The chain-webhook evaluator now fills `webhook_outbox.block_time` from the block it matched, and logs one `chain_evaluator_tick` event per tick (raw tip, bound tip, cursor before/after, emitted count, tick duration) for latency measurement. The Index remote-decoder-bound path now prefers a server's `committedBlockHeight` when it sends one, falling back to the older `checkpointBlockHeight - 1` against a server that hasn't shipped it yet.
