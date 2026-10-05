---
"@secondlayer/cli": patch
---

`secondlayer setup` compose sizes the Postgres cache (`POSTGRES_SHARED_BUFFERS`, default 1GB) so a full-chain sync doesn't stall on index reads.
