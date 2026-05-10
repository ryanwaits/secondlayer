---
"@secondlayer/indexer": patch
"@secondlayer/api": patch
---

fix decoder freeze when server-side filter eliminates every event in scanned range

`readCanonicalStreamsEvents` advances `next_cursor` past `toHeight` instead of returning `null` for empty filtered scans — fixes BNS/FT decoders that pinned at previous cursor and spun forever in `consume()`.

`runDecoder` passes `maxEmptyPolls: 1` so `consume()` returns periodically and the liveness ping keeps `l2_decoder_checkpoints.updated_at` fresh.

Status route drops unimplemented `reorgs.last_24h`.
