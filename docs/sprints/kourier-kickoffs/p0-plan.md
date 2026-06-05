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
- [x] T1 cutover script validated end-to-end in a throwaway 2-DB Postgres: dry-run (counts + schema discovery), execute (24 control tables + per-tenant subgraph schema dump→load), row-count parity, idempotent re-run (accounts 5→5, not 10). `getSourceDb()!==getTargetDb()` covered by db-dual.test (distinct URLs → distinct pools) + getDbSplitStatus (active=true).
- [x] T2 updated runbook (script-driven, default-on, remove DATABASE_URL, /status verify) + SCHEMA_SPLIT.md + ARCHITECTURE.

## Validation summary
- shared db-dual.test + new getDbSplitStatus/assertDbSplit cases: 11 pass.
- shared index-http.test (retry on transport/503, no-retry on 404, give-up after 4): 4 pass.
- tsc green: shared, api, worker, subgraphs.
- compose base + prod (`-f docker-compose.yml -f hetzner.yml`) `config` valid; api `replicas: 2`, exposed (no host port); postgres-platform default-on + volume bound to DATA_DIR.
- deploy.sh `bash -n` clean; rolling recreate + `caddy validate` gate added.
- Caddyfile: `caddy validate` (caddy:2-alpine) → "Valid configuration" (dynamic-a upstream + passive failover). deploy.sh also gates on it before restart.
- Cutover script re-validated after review fixes: happy path 24-table parity + idempotent; negative path (missing SOURCE table) → `pg_dump --strict-names` exit 1, TARGET untruncated.

## Founder-manual remaining (out of automated scope)
- Execute prod cutover window (snapshot → run split-platform-db.sh → flip env, remove DATABASE_URL → redeploy → verify /status).
- Roll `API_REPLICAS=2` into prod (confirm host RAM for 2×2G first).

## Unresolved
- Prod host RAM for 2×api@2G.
- Who/when executes prod cutover window.
- Add DB-tap auto-fallback to processors, or is N>1+retry enough (plan: latter)?
</content>
</invoke>
