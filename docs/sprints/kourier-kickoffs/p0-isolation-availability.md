# Kickoff — P0: Service Isolation & Availability

> **First read `docs/sprints/kourier-kickoffs/_context.md` and `docs/audits/kourier-parity-audit.md` (§3.6, §5 P0, §6).**
>
> **Goal of this session:** diagnose the two P0 findings against current source, resolve the two founder decisions, and produce + review a dependency-aware sprint plan, then implement it. P0 is the highest-leverage tier — it is the blocker behind Kourier's whole microservice-decomposition premise: today the decomposition is *logical-only*.

These two are dependency-linked: #1 (DB split) is the isolation blocker; #2 (API replicas) both removes the deploy 502 window AND gives the streams-index processors a stable upstream, de-risking the P1 realtime work and the P2 image split. Sequence #2's replica work to also unblock `processors-depend-on-api` (P2).

---

## P0-1 — Source/target DB split is wired but DORMANT in prod  `[HIGH]`

**id:** `shared-postgres-bus-dormant-split` · status: shipped-partial (code complete, cutover + visibility not done)

**Problem.** `getSourceDb()`/`getTargetDb()` both fall back to `DATABASE_URL` when `SOURCE_/TARGET_DATABASE_URL` are unset — the prod default. `postgres-platform` is `profiles:["split"]`, so it's excluded from a default `docker compose up`. One Postgres instance still carries chain ingest, decoded L2 writes, tenant subgraph schemas, control-plane tables, and **all reads** — one bad vacuum/query stalls all 7 services. `assertDbSplit` only warns when a split is *requested* and collapses; with neither var set (prod default) it returns early, so the dormant single-failure-domain state is **silent**, and no `/status` field surfaces split-active vs collapsed.

**Evidence (confirm before planning):**
- `packages/shared/src/db/index.ts:66-76` — `resolveSourceUrl()`/`resolveTargetUrl()` fall back `SOURCE_/TARGET_ || DATABASE_URL || DEFAULT`.
- `packages/shared/src/db/index.ts:85-96` — `assertDbSplit` returns early when neither var set (silent dormant state).
- `docker/docker-compose.yml:29-43` — `postgres-platform` is `profiles:["split"]`; lines ~70-71/89-90/156-157/223-224/282-283/310-311 default `SOURCE_/TARGET_DATABASE_URL` to `''` across migrate/api/indexer/l2-decoder/subgraph-processor/worker (comment: "Set at cutover").
- `packages/api/src/routes/status.ts` — no split/source_database/target_database field.

**Fix direction.** Execute the G4 cutover: stand up `postgres-platform` in the default prod compose, COPY control-plane tables over, set `TARGET_DATABASE_URL`. Add a `/status` (or `/health`) assertion surfacing split-active vs collapsed so dormancy is visible. Reuse the hardened G4 sub-plan in `docs/sprints/data-plane-gap-remediation.md` (G4 sprints + cutover risks: chain volume 100s GB, dump/restore FK order, rewire all 3 compose files, NEVER run `migrate` against the chain instance) and the runbook at `docs/.../database source/target cutover` (commit `7dab5441`).

**Founder decisions to resolve in-session (BLOCKER):**
- **DECODED-SET HOME:** decoded_events + l2_decoder_checkpoints + sbtc_*/bns_*/pox4_* stay on **SOURCE** (recommended — chain-derived, readers already source-read them) vs move to TARGET. Per current design + memory: chain/decoded stay on SOURCE, only control-plane (accounts, api_keys, sessions, usage, billing) moves to TARGET.
- **Cutover window:** dump/restore downtime acceptable vs logical-replication zero-downtime?
- **Remove `DATABASE_URL` entirely in split prod** (surfaces misconfig, recommended) vs keep as safety default?

---

## P0-2 — Every push = 1-2 min 502; single API instance, no rolling deploy  `[MEDIUM]`

**id:** `deploy-502-window-no-replicas` · status: known-open

**Problem.** `compose up -d` recreates the single API container on every deploy (no replicas); migration deploys additionally stop lock-holders and `pg_terminate_backend` all DB sessions. For an immutable, aggressively-cacheable read plane this downtime is avoidable. Code-only deploys are detected and skip migrate but still incur the recreate gap.

**Evidence (confirm before planning):**
- `docker/scripts/deploy.sh:125-165` — stops `MIGRATION_LOCK_HOLDERS` (incl api, ~129), terminates DB sessions (147-152), always ends with `compose up -d ... $APP_SERVICES` (165) = hard cut of the single api container. Code-only path detected via git diff on `packages/shared/migrations/` (99-106) skips stop+migrate (156-158) but still recreates. Comment at `:93` calls it a "rolling restart" — misleading for one replica.
- `docker/docker-compose.yml:78-143` — api service has NO `deploy.replicas`; fixed host port `${API_PORT:-3800}:3800` (128-129) structurally precludes >1 instance under plain compose.
- `docker/Caddyfile:18` — single-upstream `reverse_proxy api:3800` (no load-balanced pool).

**Fix direction.** Run N>1 api instances behind Caddy with a rolling recreate (or blue/green): drop the fixed host port, give Caddy a load-balanced upstream pool, recreate one replica at a time so the cached read plane stays up. Caddy already fronts the API, so this is low-cost. **Sequence so this also resolves `processors-depend-on-api` (P2):** with N>1 api, a single restart never stalls the streams-index subgraph-processor/l2-decoder data plane.

**Founder decision to resolve in-session:**
- **API replicas:** approve N>1 api behind Caddy? (low-cost; resolves the 502-per-push window and de-risks processor→api coupling). Rolling-recreate vs full blue/green?

---

## Deliverable

A reviewed sprint plan covering both findings (DB cutover sprint(s) + replica/rolling-deploy sprint(s)), with the founder decisions resolved or escalated, each task atomic + validated, sequenced so P0-2's replica work also closes `processors-depend-on-api`. Then implement, with a changeset per changed package and a staging validation of `getSourceDb() !== getTargetDb()` end-to-end before any prod cutover.
