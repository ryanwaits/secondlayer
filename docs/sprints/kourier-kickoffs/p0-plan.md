# P0 Plan — Service Isolation & Availability (executed)

Derives from `p0-isolation-availability.md`. Founder decisions resolved: control-plane→TARGET only (chain+decoded stay SOURCE); dump/restore cutover w/ brief downtime; remove `DATABASE_URL` in split prod; N>1 API rolling-recreate behind Caddy.

Scope: all code/config/script + staging validation. Prod cutover + replica rollout remain founder-driven manual ops (runbook-ready).

## Sprint 1 — DB-split visibility + safety (code-only)
- [ ] T1 `shared/db/index.ts` export `getDbSplitStatus()` → `{mode,active,sourceDb,targetDb}` (name+host only). — db-dual.test + tsc.
- [ ] T2 `assertDbSplit()`: warn-in-prod on dormant (neither var set); error if `DATABASE_URL` unset AND resolved URL === `DEFAULT_URL`. — db-dual.test.
- [ ] T3 wire `assertDbSplit()` into worker + subgraph-processor entrypoints. — grep 5 entrypoints + tsc.
- [ ] T4 `api/routes/status.ts` add `database.split` to `/status` + `/public/status`. — status.test + curl.
- [ ] T5 changesets shared/api/worker/subgraphs.

## Sprint 2 — postgres-platform default-on + cutover script (no prod exec)
- [ ] T1 remove `profiles:["split"]` from postgres-platform (base compose).
- [ ] T2 hetzner: platform data-volume + depends_on service_healthy on migrate/api/worker/subgraph-processor.
- [ ] T3 `docker/scripts/split-platform-db.sh` (start → dual-migrate --no-deps → pg_dump --data-only FK order → restore → verify; --dry-run). — shellcheck + dry-run vs 5435.

## Sprint 3 — API replicas + Caddy LB + rolling deploy (no prod exec)
- [ ] T1 api `ports`→`expose`; `deploy.replicas: ${API_REPLICAS:-1}`.
- [ ] T2 Caddyfile dynamic-a upstream + passive failover.
- [ ] T3 hetzner `API_REPLICAS` default 2.
- [ ] T4 deploy.sh rolling per-replica recreate; replace localhost:3800 probe.
- [ ] T5 `shared/index-http.ts` bounded connection-retry → closes processors-depend-on-api.

## Sprint 4 — staging validation + docs
- [ ] T1 run cutover script vs local two-DB; assert `getSourceDb()!==getTargetDb()` end-to-end.
- [ ] T2 update runbook + SCHEMA_SPLIT.md + ARCHITECTURE.

## Unresolved
- Prod host RAM for 2×api@2G.
- Who/when executes prod cutover window.
- Add DB-tap auto-fallback to processors, or is N>1+retry enough (plan: latter)?
</content>
</invoke>
