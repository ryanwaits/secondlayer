# PRD 0001 — Stacks Streams

**Status:** Draft → In Build (Phase 1, week 1)
**Owner:** Ryan
**Last updated:** May 2026
**Related docs:** `ARCHITECTURE.md` §L1, `PRODUCTS.md` → Stacks Streams, `ROADMAP.md` Phase 1

---

## Summary

Stacks Streams is the public read surface over L1 — raw, ordered, append-only Stacks chain events. It is the lowest-level interface Second Layer exposes. This PRD specifies the API surface, bulk-dump format, schema, semantics, and acceptance criteria for the Phase 1 launch (cursor API + canonical lookup) and the Phase 2 follow-on (parquet bulk dumps).

Streams is **read-only**. It is not a webhook system. It is not a filter DSL. Push semantics live in Subscriptions (over L2/L3). Webhook delivery from raw events is Hiro Chainhooks' lane and we do not rebuild it.

**Lineage.** Streams is the direct realization of the raw-events service described in Project Kourier (aulneau, 2022) — "a self-updating S3 bucket people can sync from" plus "an endpoint for exposing canonical block hashes so clients can ensure their data is canonical." Both are first-class in this design. See [`docs/references/project-kourier-transcript.md`](../references/project-kourier-transcript.md).

## Goals

1. Expose every Stacks chain event with a stable cursor.
2. Make backfill, archive, and custom-decoder use cases trivial — anyone with our Streams endpoint can build their own indexer.
3. Be the cleanest read API in the ecosystem: cursor-paginated, deterministic, well-documented.
4. Land paid auth + metering from day one. Streams contributes to the Build/Scale tier value props.

## Non-goals

- Push delivery, SSE, or webhooks over raw events.
- A filter DSL beyond a small set of dimensions.
- Decoded events (that's Stacks Index).
- Subgraph-style materialized views (that's Stacks Subgraphs).
- Historical archive beyond the per-tier window in this release. Full archive is an Enterprise SKU.

## Audience

- Teams building their own indexers, archivers, or custom decoders.
- Researchers pulling historical event slices.
- Internal use: Stacks Index event decoders read Streams as their input; the first dogfood decoder is `ft_transfer`.

## API surface

Base path: `https://api.secondlayer.tools/v1/streams`

### `GET /events`

The primary endpoint. Returns events in strict on-chain order.

**Query parameters**

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `cursor` | string | `null` | `<block_height>:<event_index>`. If null, starts at the beginning of the tier's retention window. |
| `limit` | int | 200 | Max 1000. |
| `event_type` | string[] | all | Repeatable. e.g. `stx_transfer`, `ft_transfer`, `nft_transfer`, `print`. |
| `contract_id` | string | null | Filter to events emitted by a specific Clarity contract. |
| `from_block` | int | tier window start | Inclusive. |
| `to_block` | int | tip | Inclusive. If `cursor` is provided, `from_block` is ignored. |

**Response**

```json
{
  "events": [
    {
      "cursor": "182431:14",
      "block_height": 182431,
      "index_block_hash": "0x...",
      "burn_block_height": 871233,
      "tx_id": "0x...",
      "tx_index": 3,
      "event_index": 14,
      "event_type": "ft_transfer",
      "contract_id": "SP000...sbtc-token",
      "payload": { "...event-type-specific..." },
      "ts": "2026-05-02T21:43:00Z"
    }
  ],
  "next_cursor": "182431:15",
  "tip": { "block_height": 182447, "lag_seconds": 3 },
  "reorgs": [
    {
      "detected_at": "2026-05-03T12:30:00Z",
      "fork_point_height": 182428,
      "orphaned_range": { "from": "182428:0", "to": "182430:42" },
      "new_canonical_tip": "182430:38"
    }
  ]
}
```

The `reorgs` array contains reorg records whose `orphaned_range` overlaps the range covered by the response. It is empty when no overlapping reorgs exist.

**Pagination contract.** Clients call `GET /events?cursor=<next_cursor>` until `events` is empty or `next_cursor === cursor`. There is no offset-based pagination.

### `GET /tip`

Returns current chain tip and ingest lag. Cheap. Use for dashboards and health checks.

```json
{ "block_height": 182447, "index_block_hash": "0x...", "burn_block_height": 871249, "lag_seconds": 3 }
```

### `GET /events/{tx_id}`

Returns all events emitted by a single transaction, in event-index order. Convenience endpoint; equivalent to filtering `/events` by `tx_id`.

### `GET /blocks/{height_or_hash}/events`

Returns all events for a specific block. Useful for replay verification.

### `GET /canonical/{height}`

Returns the canonical `index_block_hash` (and burn-block hash) for a given Stacks block height. Cheap, cacheable, uses an HTTP `ETag` keyed on the hash so clients can `If-None-Match` cheaply.

```json
{
  "block_height": 182431,
  "index_block_hash": "0x...",
  "burn_block_height": 871233,
  "burn_block_hash": "0x...",
  "is_canonical": true
}
```

**Why this exists.** External indexers, archivers, and parquet consumers don't want to replay our reorg history to verify they're on canonical state. They want a single cheap call: "at height N, what's canonical?" If their local hash matches, they're good. If not, they re-sync the affected range. This is the Kourier canonical-block-hashes endpoint, lifted intact.

### `GET /reorgs`

Returns reorg records ordered by `detected_at`, ascending. Cheap, cacheable, intended for observability, alerting, and audit. Most consumers use the inline `reorgs` array on `/events`.

**Query parameters**

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `since` | timestamp or cursor | required | Return records detected after a timestamp or whose range is after a cursor. |
| `limit` | int | 100 | Max 1000. |

```json
{
  "reorgs": [
    {
      "detected_at": "2026-05-03T12:30:00Z",
      "fork_point_height": 182428,
      "orphaned_range": { "from": "182428:0", "to": "182430:42" },
      "new_canonical_tip": "182430:38"
    }
  ],
  "next_since": "2026-05-03T12:30:00Z"
}
```

### Bulk dumps (Phase 2)

Parquet files on S3, partitioned by block-height range. Refreshed continuously; manifest file lists current parts and their canonical-hash range.

- **Path:** `s3://secondlayer-streams/v1/events/height=NNNNNN-NNNNNN/part-XXXX.parquet` where each partition spans 10K Stacks blocks.
- **Manifest:** `s3://secondlayer-streams/v1/manifest.json` — lists all current parts, last-updated timestamp, and the canonical hash at the manifest's tip.
- **Recommended client pattern:** `aws s3 sync` historical, then call `/canonical/{height}` to verify, then tail `/events?cursor=...` from the synced tip.
- **Tier access:** included on Build, Scale, Enterprise. Free tier reads via the cursor API only.
- **Schema:** identical column set to the cursor API event shape, plus `partition_block_range` for compatibility with DuckDB / Athena / Spark.

## Schema

### Event types (v1)

| `event_type` | Source | Notes |
|---|---|---|
| `stx_transfer` | core | STX moved between principals |
| `stx_mint` | core | minting/coinbase |
| `stx_burn` | core | burns |
| `stx_lock` | core | stacking locks |
| `ft_transfer` | SIP-010 | fungible token transfer |
| `ft_mint` | SIP-010 | fungible token mint |
| `ft_burn` | SIP-010 | fungible token burn |
| `nft_transfer` | SIP-009 | non-fungible token transfer |
| `nft_mint` | SIP-009 | non-fungible token mint |
| `nft_burn` | SIP-009 | non-fungible token burn |
| `print` | core | Clarity `print` events |

Only chain-emitted events appear in this table. `contract_call` is a transaction and stays outside Streams; the legacy transaction path remains indexer-internal until a future PRD retires or replaces it. Reorgs are response-envelope metadata, not events.

### Cursor format

`<block_height>:<event_index>` where `event_index` is the Nth real chain-emitted event in the block, monotonically increasing across all transactions in canonical transaction order, starting at 0. No synthetic slots, nulls, or tagged unions. Cursors are stable across replays and reorg recoveries — the same `(block_height, event_index)` after a reorg is the post-reorg event.

### Reorg semantics

When the indexer detects a reorg:

1. The internal L1 store rolls back affected blocks.
2. Replays produce new events with the same cursor space.
3. A reorg record is written with `{ detected_at, fork_point_height, orphaned_range: { from, to }, new_canonical_tip }`.

Clients dedupe by cursor and treat inline `/events` `reorgs` records as a signal to invalidate downstream state in the affected range. We document a reference dedupe pattern in the SDK.

## Auth and metering

- Bearer token in `Authorization` header, scoped to a tenant + product (`streams:read`).
- Free tier rate limits enforced at the gateway: 10 req/s, 7-day retention window, 1000 events per request.
- Build: 50 req/s, 30-day window.
- Scale: 250 req/s, 90-day window.
- Enterprise: custom; full archive available.
- Metered units: **events returned** (not requests). Billing aggregator runs nightly off API logs.

## SLOs

- **Availability:** 99.5% (Build), 99.9% (Scale). Measured monthly, public on status page.
- **Ingest lag (tip → readable):** p95 ≤ 5s, p99 ≤ 15s. Published on status page.
- **Cursor stability:** 100% — cursors after a reorg are deterministic. This is a correctness property, not an SLO; failure is treated as an incident.

## Operational requirements

- Status page surfaces Streams ingest lag, p50/p95 latency, error rate, and reorg records in the last 24h.
- Dashboards (internal): per-tenant request rate, event volume, top contract_id by traffic.
- Alerting: ingest lag p95 > 15s for 5m; error rate > 1% for 5m; reorg depth > 6 blocks.

## Security

- TLS only.
- API keys hashed at rest.
- No PII in event payloads (all data is on-chain public).
- Rate limit + per-tenant quota at the gateway.

## SDK and docs

- TypeScript SDK in `packages/sdk` ships a `StreamsClient` with cursor-paginated iteration helpers and a reference dedupe-by-cursor pattern.
- v1 ships `@secondlayer/sdk` with the first Kourier-style helper: `isFtTransfer` and `decodeFtTransfer` over `ft_transfer` Streams events.
- Reference docs include: quickstart, schema for every `event_type`, reorg handling guide, tier limits page.
- One worked example: "Build a custom sBTC transfer indexer in 50 lines."

## Acceptance criteria

The Streams launch is done when **all** of the following are true:

1. `GET /events`, `/tip`, `/events/{tx_id}`, `/blocks/{height_or_hash}/events`, and `/reorgs` are live in production behind paid auth.
2. Cursor pagination works across the full retention window for the tier.
3. Replay of the last 30 days produces byte-identical event sequences (modulo timestamps) — verified by a fixture test.
4. A simulated reorg in staging produces correct reorg envelope records and post-reorg cursors match expectations.
5. Status page shows Streams metrics (ingest lag, p50/p95, error rate).
6. Rate limits, retention windows, and event-count metering are enforced and visible to tenants.
7. TypeScript SDK published, with quickstart and reorg-handling guide.
8. One internal customer (Stacks Index decoder) reads exclusively from Streams in production.
9. One external design-partner team is using Streams in staging or production with their feedback logged.

## Open questions

- **Resolved: include `print` events in v1.** They are native chain-emitted events, cheap to store, and common enough that excluding them would force consumers into custom paths.
- **Resolved: confirmed blocks only in v1.** Microblocks are excluded to keep cursor semantics tied to canonical blocks; revisit only with a partner-backed PRD.
- **Resolved: cursor-API archive is Enterprise-only; parquet bulk dumps are included on Build and above.** This keeps hot retention bounded while preserving scalable historical backfill.
- **Resolved: bulk dumps use 10K-block partitions.** Smaller partitions make reorg repair and partial backfill cheaper; revisit after first month of usage data.

## Risks

- **Cursor design churn.** If we get cursor semantics wrong, every downstream consumer breaks. Mitigation: lock cursor format before any external customer touches the API; treat as a 1.0 contract.
- **Reorg correctness bugs.** Mitigation: deterministic replay test on every PR touching the indexer; staging-only reorg fuzzer.
- **Confusion with Hiro Chainhooks.** Mitigation: docs lead with "Streams is read-only; if you want push, see Chainhooks or our Subscriptions."

## Out of scope (revisit later)

- Push transports (SSE, WebSocket) over L1 events.
- Filter DSL beyond `event_type` and `contract_id`.
- Microblock-granularity events.
- Per-event-type parquet shards (single combined event stream in v1; split-by-type is a v1.2 if anyone asks).

---

*This PRD is the contract for Phase 1 week 1–3. Update when scope changes; treat acceptance criteria as the gate for marking the deliverable done.*
