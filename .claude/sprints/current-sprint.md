# Current Sprint - Phase 1, Stacks Index Closeout

**Phase:** 1 (Reliability + Surfaces)
**Sprint:** Sprint 2 - Stacks Index MVP
**Dates:** May 4 - May 10, 2026
**Headline goal:** Close the Stacks Index public surface, then move into Phase 1 hardening.
**Active PRD:** `docs/prds/0002-stacks-index.md`

---

## North Star

Paid customers can query decoded `ft_transfer` and `nft_transfer` events from `/v1/index/*`, with SDK support, docs, and public status freshness. Once closed, hardening work proceeds in priority order.

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

1. Broader verification across touched API, SDK, and web surfaces.
2. Review git diff for accidental scope creep.

## Tech Debt Accepted Into Next Sprint

- Migration safety doc / dual-write pattern.
- Standardize missing-env-var defaults pattern.

## Daily Log

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

## Notes

- L2 is decoded events, not transactions.
- Cursor format stays `<block_height>:<event_index>`.
- Every successful Index response returns top-level `reorgs` as an array.
- `.agents/current-sprint.md` and `docs/sprints/current-sprint.md` are pointers only. Do not split tactical state across those files again.
