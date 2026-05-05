# Current Sprint - Phase 1 API, SDK, and DX Completion

**Phase:** 1 (Reliability + Surfaces)
**Sprint:** Sprint 2 - Layered API Completion
**Dates:** May 4 - May 10, 2026
**Headline goal:** Close the additive API, SDK, and DX gaps across Stacks Streams, Stacks Index, and Stacks Subgraphs.
**Active PRD:** `docs/prds/0004-phase-1-api-sdk-dx-completion.md`

---

## North Star

Developers can start from one mental model: Stacks Streams for raw ordered L1 events, Stacks Index for decoded FT/NFT L2 events, and Stacks Subgraphs for app-specific L3 tables. The API, SDK, and docs expose that model without requiring source-code reading.

## Completed

- Task 1 - Stacks Index schema + PRD 0002 + migration 0066 (PR #25).
- Task 2 - `/v1/index/ft-transfers` + continuous `l2-decoder` + SDK list (PR #28, hotfixes #30-#34).
- Task 3 - `/v1/index/nft-transfers`.
- Task 4 - SDK `ftTransfers.list`, `nftTransfers.list`, and async `walk` helpers verified.
- Task 5 - `/stacks-index` docs page and `/status` FT/NFT freshness tiles verified and closed.
- H1 - CI lints docker scripts under nounset (PR #35).
- H2 - Continuous-service smoke harness (commit a0bb763).
- H3 - Post-deploy CI smoke check on `/events`, `/index`, `/tip` with auth variants.
- Sprint-zero - Agent operating harness (commits 40caa47, 5d3835e, 6ded35b, 39ab645).

## Current Priority

1. Add the PRD 0001 Streams read conveniences and shared reorg metadata lookup.
2. Align the SDK root client around `sl.streams`, `sl.index`, and `sl.subgraphs`.
3. Refresh API, SDK, and product docs around the three-layer model.
4. Run focused API, SDK, and web verification.

## Tech Debt Accepted Into Next Sprint

- Migration safety doc / dual-write pattern.
- Standardize missing-env-var defaults pattern.

## Daily Log

- **Sprint rescope:** Added PRD 0004 for Phase 1 API, SDK, and DX completion. Active sprint now prioritizes additive Stacks Streams, Stacks Index, and Stacks Subgraphs surface completion. Reliability code/status work is treated as green for sprint planning; production backup/PITR proof and server expansion stay deferred to the funded infrastructure milestone.
- **Week kickoff:** Sprint dates corrected to May 4 - May 10, 2026. Canonical sprint source moved to `.claude/sprints/current-sprint.md` to match `AGENTS.md`.
- **Task 1:** Drafted PRD 0002 and L2 schema migration. Paused for deploy hotfix verification, then resumed.
- **Task 2:** Added `/v1/index/ft-transfers`, SDK list method, separate Index rate-limit bucket, and continuous `l2-decoder` compose service with checkpoint health.
- **Task 5 initial:** Added `/stacks-index` docs, marketing home freshness badge, and `/status` Index decoder freshness.
- **Task 5 follow-up:** Added `/stacks-streams` docs, moved the home freshness badge to the bottom-right viewport, and made its status source public-only.
- **Deploy hotfix:** NFT decoder skips malformed NFT transfer rows with missing raw value and checkpoints past them.
- **Deploy hotfix 2:** L2 decoder health counts recent checkpoint movement, so catch-up without valid NFT writes passes readiness.
- **Task 4 closeout:** Verified SDK Index support for `ftTransfers.list`, `nftTransfers.list`, and async `walk` helpers. `bun test packages/sdk/src/__tests__/index-client.test.ts`, `bun run --cwd packages/sdk typecheck`, and full SDK tests pass.
- **Task 5 closeout:** `/stacks-index` docs smoke test passes. `/status` reads the public status snapshot and renders FT/NFT decoder freshness. Web status/marketing smoke tests, web typecheck, and API status tests pass.
- **Hardening - runtime tokens:** Streams and Index auth now fall back from seeded internal/test keys to active `api_keys` joined with account plans at request time. This avoids API redeploys when customer keys change. Verified with product-token-store tests, Streams/Index gateway tests, and API typecheck.
- **Hardening - post-deploy smoke:** `scripts/ci/post-deploy-smoke.sh` now checks `/health`, `/public/status`, public Streams freshness, public Index decoder freshness, and the existing Streams/Index auth variants. `bash -nu scripts/ci/post-deploy-smoke.sh` passes.
- **Hardening - staging health:** Added scheduled/manual `.github/workflows/staging-health.yml` and `scripts/ci/staging-health.sh`. The monitor checks public Streams lag, FT/NFT decoder freshness, optional authorized DB status, and optional recent canonical `timestamp=0` blocks through Postgres. `bash -nu scripts/ci/staging-health.sh` passes.
- **Hardening - bounded Streams SDK:** Added `mode: "bounded"` to `consumeStreamsEvents` and exposed `emptyBackoffMs`, `maxPages`, and `maxEmptyPolls` on the async Streams iterator. Focused Streams SDK tests and SDK typecheck pass.
- **Hardening - Streams retention:** Updated `STREAMS_BLOCKS_PER_DAY` to the post-Nakamoto five-second cadence approximation (`17,280`) while keeping the public tip shape unchanged. Focused Streams/Index window tests and API typecheck pass.
- **Hardening - deploy detachment:** GitHub deploy now starts `/opt/secondlayer/docker/scripts/deploy.sh` through a transient systemd unit via `scripts/ci/remote-deploy-systemd.sh`; operations docs include `systemctl status` and `journalctl -u` inspection commands.
- **Closeout verification:** `sk-sl_streams_status_public` is documented as public/non-secret in the SDK README. Local `5435` was occupied by an unrelated Postgres container, so migrations and DB-backed API/indexer tests ran against isolated Postgres on `127.0.0.1:55435`. API, indexer, SDK, and web tests/typechecks pass; bash nounset checks pass; `actionlint` was unavailable locally.
- **Hardening - image deploys:** Deploy CI now builds and pushes SHA-tagged GHCR images for `api`, `indexer`, `worker`, `agent`, and `provisioner`; production deploy pulls exact images and runs `up --no-build`. Added host deploy state tracking plus a manual image-only rollback workflow. Bash nounset checks, deploy/rollback workflow YAML parse, compose config, full build, and full typecheck pass locally.
- **Closeout verification follow-up:** Broader API, SDK, and web verification is clean. `bun run --cwd packages/api test`, `bun run --cwd packages/sdk test`, `bun run --cwd apps/web test`, and matching typechecks all pass.
- **Phase 1 hardening planning:** Audited remaining reliability gate work and drafted `docs/prds/0003-phase-1-reliability-hardening.md`. The gaps are public status completeness, product usage metering, pricing/docs alignment, and recovery-readiness evidence.
- **PRD 0003 rescope:** Rescoped Phase 1 reliability hardening from hot-spare failover closeout to single-server production reliability closeout. Hot-spare automation is deferred until funded second-node capacity exists.
- **Phase 1 reliability implementation:** Added rolling API telemetry, expanded `/public/status` and `/status`, public status UI coverage, product usage counters/metering for Streams and Index, locked pricing copy, expanded smoke checks, and `docker/docs/PHASE1_RECOVERY_RUNBOOK.md`.
- **Recovery drill prep:** Runbook/checklist/log template is ready. Phase 1 closeout still needs Ryan-recorded non-destructive production drill evidence.
- **Phase 1 recovery drill evidence:** Ran a non-destructive production drill on May 4, 2026 at 22:23–22:24 UTC via `ryan@claude-mini` -> `app-server` as Ryan requested. Containers were running (`api`, `indexer`, `l2-decoder`, `postgres`, `agent`, `provisioner` healthy; `worker` running). `/health`, `/public/status`, `/v1/streams/tip`, one Stacks Streams read, and one Stacks Index read all returned HTTP 200. No restart or rollback was exercised.
- **Recovery drill follow-ups:** The live `/public/status` now has the expanded status shape, but `services[]` still reports `indexer: unavailable` until the API gets the internal `INDEXER_URL` setting in production. Backup verification found root cron scheduling rather than systemd timers; weekly `pg_basebackup` completed May 3, 2026 at 04:48 +02:00 and remote upload completed May 4, 2026 at 05:02 +02:00, but the May 4 daily `pg_dump` failed on `events` and `sync-wal.log` has not updated since April 19. Treat backup freshness as partial until pg_dump/WAL follow-up is fixed or explicitly accepted.
- **Reliability closeout patch:** Added `INDEXER_URL=http://indexer:3700` to the API container, changed Staging Health to gate FT/NFT decoders on public `status` while printing `lagSeconds`, and tightened required service checks so `indexer: unavailable` fails the gate. Made shared Postgres `pg_dump` atomic and gzip-verified, added the DB maintenance lock shared with deploy, enabled WAL archiving in the Hetzner compose override, and made WAL env loading tolerate unquoted `.env` values.
- **Reliability closeout verification:** Individual `bash -nu` checks pass for deploy, backup, WAL sync, Staging Health, and post-deploy smoke scripts. Compose config renders the API `INDEXER_URL` and Postgres WAL archive settings. Focused API/indexer status tests and API typecheck pass. Current production `/public/status` still reports `indexer: unavailable`, so Phase 1 remains open until this patch is deployed and backup/WAL evidence is recorded.
- **API/SDK/DX completion:** Added Stacks Streams canonical, transaction events, block events, and reorg listing routes; added `chain_reorgs` storage, reorg handler writes, shared overlap lookup, Index reorg envelopes, and `burn_block_hash` storage for new blocks.
- **SDK/docs alignment:** Added root `sl.streams`, Streams convenience SDK methods, and docs for the Stacks Streams / Stacks Index / Stacks Subgraphs mental model. Focused API, SDK, shared, indexer, and web tests/typechecks pass locally.

## Phase 1 Recovery Drill - May 4, 2026

- Date/time: May 4, 2026, 22:23:49–22:24:21 UTC.
- Operator: Codex on Ryan's behalf.
- Environment: production, non-destructive.
- Checklist used: `docker/docs/PHASE1_RECOVERY_RUNBOOK.md`.
- Health inspection result: `api`, `indexer`, `l2-decoder`, `postgres`, `agent`, and `provisioner` running healthy; `worker` running.
- Backup freshness result: weekly basebackup complete on May 3, 2026; remote upload complete on May 4, 2026; daily pg_dump failed on May 4, 2026; WAL sync log stale since April 19, 2026.
- Service restart exercised: none.
- Rollback exercised: no.
- `/health` result: HTTP 200.
- `/public/status` result: HTTP 200, current pre-telemetry production shape.
- `/v1/streams/tip` result: HTTP 200.
- Stacks Streams read result: `/v1/streams/events?limit=1` HTTP 200.
- Stacks Index read result: `/v1/index/ft-transfers?limit=1` HTTP 200.
- Manual intervention required: none during drill.
- Follow-up items: deploy final reliability patch; confirm `/public/status.services[]` reports `indexer: ok`; record two consecutive green Staging Health runs; record fresh daily pg_dump and WAL sync evidence.

## Notes

- L2 is decoded events, not transactions.
- Cursor format stays `<block_height>:<event_index>`.
- Every successful Index response returns top-level `reorgs` as an array.
- `.agents/current-sprint.md` and `docs/sprints/current-sprint.md` are pointers only. Do not split tactical state across those files again.
