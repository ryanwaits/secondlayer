---
"@secondlayer/indexer": minor
---

Gate the singleton background loops (integrity, tip-follower, all dataset publishers, contract registry) behind leader election. Opt-in via `INDEXER_LEADER_ELECTION=true`: exactly one instance runs the loops while the HTTP ingest server runs on every instance, making it safe to run multiple indexers. Default off preserves single-instance behavior.
