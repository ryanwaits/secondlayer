---
"@secondlayer/api": patch
"@secondlayer/shared": patch
---

perf(events): expression index on `data->>'contract_identifier'`

Print-event scans filtered by contract used to fall back to a sequential scan of the events table (53M+ rows on mainnet) — query took 2-3s at limit=100, 5-20s at limit=500, surfacing as `socket connection was closed unexpectedly` errors in the L2 BNS decoder. New partial expression index `events_contract_event_contract_id_idx` brings those queries to ~1ms via Index Scan.

- `@secondlayer/shared@*`: ships migration `0073_events_contract_id_idx.ts` (`CREATE INDEX IF NOT EXISTS …`). The index was already applied to prod via `CREATE INDEX CONCURRENTLY` on 2026-05-09; the migration is a no-op there but seeds dev/staging.
- `@secondlayer/api@*`: reverts the `Bun.serve idleTimeout: 60` workaround introduced 2026-05-09 — back to default. Indexed query no longer needs the extended timeout.
