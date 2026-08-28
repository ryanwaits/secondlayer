---
"@secondlayer/cli": minor
---

`restore --apply` runs `pg_restore` in one transaction and stops on the first error, so a failed restore leaves the target as it was; after the load the canonical block range is checked against the manifest's scope and a short dump exits 1. Backup and restore hash the dump in fixed reads, so a multi-gigabyte bundle no longer needs to fit in one buffer.

Archive partition fetches in `bootstrap` and `repair` retry three times with backoff on connection resets, timeouts, 429 (honoring `Retry-After`) and 5xx. A link that stays down exits 1 with a re-run hint instead of 2 "refused"; the re-run resumes where the load stopped.

`streams consume` prints reorgs inline as `{"kind":"reorg",...}` lines and rewinds to the fork point, checkpoints from the loop's own cursor, and rejects a `--max-pages` that is not a positive integer with exit 1 rather than streaming nothing. `subgraphs status --watch` rides out three consecutive failed polls and exits on `sync.status`, not the lifecycle column. `subscriptions test --post --local` times out after 15s.
