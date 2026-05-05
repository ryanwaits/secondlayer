# PRD 0004 - Phase 1 API, SDK, and DX Completion

**Status:** In Build (Phase 1, week 1)
**Owner:** Ryan
**Last updated:** May 5, 2026
**Related docs:** `ARCHITECTURE.md` L1/L2/L3, `PRODUCTS.md` product catalog, `ROADMAP.md` Phase 1, `docs/prds/0001-stacks-streams.md`, `docs/prds/0002-stacks-index.md`, `docs/prds/0003-phase-1-reliability-hardening.md`

---

## Summary

This sprint closes the additive API, SDK, and developer-experience gaps across the three layered read surfaces: Stacks Streams (L1), Stacks Index (L2), and Stacks Subgraphs (L3).

Reliability code and local status gates are treated as green for sprint planning. Production backup/PITR proof, server expansion, hot-spare capacity, and failover rehearsal remain deferred to the funded infrastructure milestone described in PRD 0003 and `ROADMAP.md`.

## Goals

1. Finish the missing Stacks Streams convenience reads from PRD 0001.
2. Persist reorg metadata and expose overlapping reorg envelopes in Stacks Streams and Stacks Index responses.
3. Keep Stacks Index v1 focused on decoded FT and NFT transfer endpoints.
4. Make Stacks Subgraphs docs and examples clearly present the L3 API.
5. Align the SDK around one mental model: `sl.streams` for L1, `sl.index` for L2, and `sl.subgraphs` for L3.
6. Update docs so developers can choose the right layer without reading source.

## Non-goals

- Cursor format changes.
- Breaking response envelope changes.
- Webhooks or push delivery from Stacks Streams.
- New Stacks Index endpoint families beyond `ft-transfers` and `nft-transfers`.
- Console, Datasets, or parquet bulk dumps.
- Full backup/PITR proof, remote restore drills, server expansion, hot-spare automation, or production failover rehearsal.

## Scope

### Stacks Streams

Add these read endpoints under `/v1/streams`:

- `GET /canonical/:height`
- `GET /events/:tx_id`
- `GET /blocks/:heightOrHash/events`
- `GET /reorgs?since=...&limit=...`

Add `chain_reorgs` storage for reorg metadata written by the existing reorg handler. Add `burn_block_hash` storage for new canonical block rows. Historical rows without `burn_block_hash` remain valid; public responses return `burn_block_hash: string | null`.

Streams response envelopes include `reorgs` records whose orphaned cursor range overlaps the returned event range.

### Stacks Index

Keep the v1 public surface limited to:

- `GET /v1/index/ft-transfers`
- `GET /v1/index/nft-transfers`

Index response envelopes reuse the shared reorg lookup. Cursor, filter, and empty-page semantics stay aligned with Stacks Streams where intended.

### Stacks Subgraphs

Keep existing management and query routes. Standardize docs and SDK examples around Stacks Subgraphs as the L3 API.

Verify query responses expose:

- `{ data, meta }` for table list routes.
- `{ count }` for count routes.

Docs should make list, detail, table query, count, source, gaps, and generated OpenAPI routes discoverable.

### SDK

Expose `sl.streams` on the root `SecondLayer` client while preserving `createStreamsClient`.

Add SDK methods for the new Streams conveniences:

- `sl.streams.canonical(height)`
- `sl.streams.events.byTxId(txId)`
- `sl.streams.blocks.events(heightOrHash)`
- `sl.streams.reorgs.list(params)`

Keep these as canonical examples:

- `sl.index.ftTransfers`
- `sl.index.nftTransfers`
- `sl.subgraphs`

### Docs and DX

Use product names exactly:

- Stacks Streams
- Stacks Index
- Stacks Subgraphs

Update API docs to cover Streams, Index, and Subgraphs. Add a short "which API should I use?" section:

- Raw ordered events: Stacks Streams.
- Decoded token and NFT events: Stacks Index.
- App-specific tables: Stacks Subgraphs.

Update PRD 0003 and `ROADMAP.md` so reliability code/status gates are marked green while full backup/PITR proof and server expansion remain deferred to the funded infrastructure milestone.

## Acceptance Criteria

1. The four Stacks Streams convenience endpoints are implemented, authorized, validated, and tested.
2. `chain_reorgs` storage exists and reorg metadata is queryable.
3. Stacks Streams `/events` and Stacks Index FT/NFT envelopes include overlapping reorg metadata without breaking existing fields.
4. Canonical block responses include `burn_block_hash: string | null`.
5. The SDK root client exposes `sl.streams`, `sl.index`, and `sl.subgraphs`.
6. SDK Streams convenience methods build the expected URLs and auth headers.
7. `createStreamsClient` remains backwards-compatible.
8. Stacks Subgraphs docs and examples document L3 table list/count response shapes and discoverable management routes.
9. API README, SDK README, PRD 0003, and `ROADMAP.md` are aligned with the sprint scope.

## Validation Plan

- `bun test packages/api/src/streams packages/api/src/index packages/api/test`
- `bun test packages/sdk/src/__tests__`
- `bun run --cwd packages/api typecheck`
- `bun run --cwd packages/sdk typecheck`
- `bun run --cwd apps/web test`
- `bun run --cwd apps/web typecheck`

---

*This PRD authorizes additive API, SDK, and documentation work for Phase 1 API completion. It does not reopen cursor semantics or reliability infrastructure scope.*
