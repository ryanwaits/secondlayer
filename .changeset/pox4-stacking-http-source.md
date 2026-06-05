---
"@secondlayer/shared": minor
"@secondlayer/api": minor
"@secondlayer/indexer": patch
---

Re-source the PoX-4 stacking decoder over the public Index HTTP API (removing its source-DB coupling), serve burn_block_height on /v1/index/transactions, and enable the stacking decoder by default (set POX4_DECODER_ENABLED=false to opt out; POX4_BACKFILL_FROM_HEIGHT bounds the backfill scan)
