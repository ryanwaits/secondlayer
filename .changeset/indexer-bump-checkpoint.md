---
"@secondlayer/indexer": patch
---

fix(l2-decoder): liveness ping bumps checkpoint updated_at every poll

The healthcheck reported "unhealthy" when a decoder finished its work and quietly polled at-tip with no new events to process. The deploy script gated on health and bailed mid-recreate. Each runDecoder iteration now bumps `l2_decoder_checkpoints.updated_at` (without touching `last_cursor`) so `checkpoint_recent` becomes a true liveness signal: "process alive and looking" not "process found new rows."
