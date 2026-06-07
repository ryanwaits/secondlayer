---
"@secondlayer/shared": patch
---

Make migration `0090_events_streams_filter_idx` timeout-safe: lift `statement_timeout` for the index-build transaction so a fresh deploy completes instead of hard-failing with error 57014 on the large `events` table. On prod the indexes are still pre-created `CONCURRENTLY` (the migration no-ops via `IF NOT EXISTS`), so no write-lock is held there.
