---
"@secondlayer/shared": patch
"@secondlayer/provisioner": patch
---

rebalance per-tenant container CPU + RAM split from `PG 50% / proc 30% / api 20%` → `PG 25% / proc 55% / api 20%`. Backfill throughput regressed massively in the move from shared infra to per-tenant containers because the proc only got 30% of plan CPU (0.6 CPU on Launch) while PG idled at <1% observed utilization. Live-tested on a Launch tenant: bumping proc from 0.6 CPU → 1.5 CPU took backfill from ~5 blocks/min to ~108 blocks/min (~21× speedup). New tenants get the new split automatically. Existing tenants need `docker update --cpus` or re-provision.
