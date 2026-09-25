---
"@secondlayer/api": patch
---

Streams reads from a first-party internal caller (the seeded decoder key, or a self-hosted `INSTANCE_TOKEN`) now serve up to the raw tip instead of holding back the usual 2-block reorg margin: the decoder already rewinds decoded rows and checkpoints on a reorg, so the margin only added latency for that reader. Public/account reads keep the existing `STREAMS_TIP_REORG_MARGIN_BLOCKS` default.
