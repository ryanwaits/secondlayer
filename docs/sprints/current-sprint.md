# Current Sprint - Phase 1, Week 2

**Phase:** 1 (Reliability + Surfaces)
**Week:** 2 of 3
**Dates:** May 11 - May 17, 2026
**Headline goal:** Ship the Stacks Index public surface for decoded transfer events.
**Active PRD:** `docs/prds/0002-stacks-index.md`

---

## North Star

By end of week, paid customers can query decoded `ft_transfer` and `nft_transfer` events from `/v1/index/*`, with SDK support, docs, and status freshness.

## Tasks

### 1. L2 schema + decoded events table
- [x] Decide shared `decoded_events` shape.
- [x] Add PRD 0002.
- [x] Add migration and DB-backed forward/down regression test.

**Done when:** PR merged with public columns, required indexes, and no endpoint changes.

### 2. `/v1/index/ft-transfers`
- [ ] Paid auth.
- [ ] Filters: `contract_id`, `sender`, `recipient`, `from_height`, `to_height`.
- [ ] Cursor pagination with `reorgs: []`.

### 3. `/v1/index/nft-transfers`
- [ ] Paid auth.
- [ ] Filters: `contract_id`, `sender`, `recipient`, `asset_identifier`, `from_height`, `to_height`.
- [ ] Cursor pagination with `reorgs: []`.

### 4. SDK L2 methods
- [ ] `client.index.ftTransfers.list`.
- [ ] `client.index.nftTransfers.list`.
- [ ] Async iterator for history walks.

### 5. Docs + status
- [ ] L2 docs page.
- [ ] Status tiles for FT and NFT freshness.

---

## Daily Log

- **Week 2 kickoff:** Locked Task 1 decisions: one shared table, full `contract_id`, text `amount`, raw NFT `value`, L1-style `reorgs: []`, separate Index rate-limit bucket.
- **Task 1:** Drafted PRD 0002 and L2 schema migration. Paused for deploy hotfix verification, then resumed.
- **Task 2:** Added `/v1/index/ft-transfers`, SDK list method, separate Index rate-limit bucket, and continuous `l2-decoder` compose service with checkpoint health.
- **Task 5:** Added `/stacks-index` docs, marketing home freshness badge, and `/status` Index decoder freshness.
- **Task 5 follow-up:** Added `/stacks-streams` docs, moved the home freshness badge to the bottom-right viewport, and made its status source public-only.
- **Deploy hotfix:** NFT decoder now skips malformed NFT transfer rows with missing raw value and checkpoints past them.
- **Deploy hotfix 2:** L2 decoder health now counts recent checkpoint movement, so catch-up without valid NFT writes passes readiness.

## Notes

- L2 is decoded events, not transactions.
- Endpoints are Task 2/3. Do not add them in Task 1.
- Cursor format stays `<block_height>:<event_index>`.
- Every successful Index response returns top-level `reorgs` as an array.
