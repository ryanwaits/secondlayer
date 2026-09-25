---
"@secondlayer/indexer": patch
---

Block ingest now NOTIFYs `indexer:new_block` on commit, and the L2 decoder service wakes its empty-poll backoff early on it instead of always sleeping the full `DECODER_EMPTY_BACKOFF_MS`. Both fall back to their existing timers if the wake connection never comes up.
