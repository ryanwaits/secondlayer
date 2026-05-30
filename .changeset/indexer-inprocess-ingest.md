---
"@secondlayer/indexer": minor
---

Extract block ingestion into an in-process `ingestNewBlock` (new `ingest.ts`). The tip-follower and auto-backfill now ingest directly instead of self-POSTing to `localhost:PORT/new_block`, which was wrong behind a load balancer and a single point of failure. The HTTP `/new_block` route is now a thin wrapper. Prep for running multiple indexer instances.
