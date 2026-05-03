# Current Sprint — Phase 1, Week 1

**Phase:** 1 (Reliability + Surfaces)
**Week:** 1 of 3
**Dates:** May 4 – May 10, 2026
**Headline goal:** Land the Streams API skeleton in production behind paid auth, with at least the `/tip` and `/events` endpoints serving real cursor-paginated data.

This is the only sprint doc that should exist at any given time. When the week ends, archive this to `.claude/sprints/archive/2026-05-04.md` and write the next one.

---

## North star for the week

By Sunday May 10, an authenticated `curl https://api.secondlayer.tools/v1/streams/events?cursor=<x>` against staging returns a real cursor-paginated event stream. Internal Index decoder is wired to read from it.

If that one sentence is true at end of week, the sprint succeeded.

---

## Tasks

Ordered by sequence. Stop work and re-plan if a task slips by more than a day.

### 1. Lock the Streams cursor + event schema (Mon)
- [x] Finalize cursor format `<block_height>:<event_index>` and write a 1-page schema doc at `docs/specs/streams-schema.md`.
- [x] Decide v1 event types (default: include `print`, exclude microblocks).
- [x] Open a fixture-test PR with 100 canonical events and their expected cursors.

**Done when:** Schema doc merged; fixture test passes locally.

### 2. Paid auth + rate limit at the gateway (Mon–Tue)
- [ ] Wire bearer-token auth into `packages/api`. Scopes: `streams:read`.
- [ ] Per-tier rate limit middleware (10 / 50 / 250 req/s).
- [ ] Per-tier retention window enforcement (7 / 30 / 90 days). For now, hard-code the windows; billing aggregation comes later in the phase.

**Done when:** A test tenant key on the Free tier gets 429'd at 11 req/s; a Build key passes through at 50.

### 3. Implement `GET /tip` (Tue)
- [ ] Cheap endpoint. Reads from indexer's tip cache.
- [ ] Includes `lag_seconds`.
- [ ] Wire into the (still-internal) status page draft.

**Done when:** `/v1/streams/tip` returns within 50ms p95 in staging.

### 4. Implement `GET /events` with cursor pagination (Wed–Thu)
- [ ] Cursor decode/encode helpers.
- [ ] Query path against L1 store with `cursor`, `limit`, `event_type`, `contract_id`, `from_block`, `to_block`.
- [ ] Hard cap `limit` at 1000.
- [ ] Returns `{ events, next_cursor, tip }` shape from PRD 0001.
- [ ] Replay test: read last 24h of mainnet via the API, compare against direct DB dump — must be byte-identical (modulo timestamps).

**Done when:** Replay test green; manual `curl` walks 10K events without losing or duplicating any cursor.

### 5. Wire internal Index decoder to read from Streams (Thu–Fri)
- [ ] Switch the L2 decoder in `packages/indexer` to consume from the Streams API instead of direct DB reads.
- [ ] Verify L2 output is unchanged across a 24h replay window.

**Done when:** L2 decode pipeline produces identical output sourced from Streams; this is the dogfooding gate.

### 6. SDK skeleton + quickstart (Fri)
- [ ] `StreamsClient` in `packages/sdk` with `eventsIterator()` async generator.
- [ ] One worked example committed: `examples/sbtc-transfer-indexer/` (50 lines, reads sBTC `ft_transfer` events).
- [ ] README quickstart page.

**Done when:** Quickstart copy-pasted into a fresh repo runs against staging.

### 7. Status page v0 (Sat, if time)
- [ ] Single public page showing: chain tip, Streams ingest lag, API p50/p95, error rate (last 24h).
- [ ] Hosted on a separate subdomain — this is intentionally not behind auth.

**Done when:** `status.secondlayer.tools` is live with at least the four metrics above.

---

## Explicitly deferred this week

- Reorg fuzzer in staging (week 2).
- `/events/{tx_id}` and `/blocks/{height}/events` convenience endpoints (week 2).
- Billing meter aggregation — count it, but don't bill yet (week 3).
- Console UI work — Phase 2.
- Datasets — Phase 2.
- Hot-spare automated failover — week 2.

If anything from this list creeps into the week, push back and link to this section.

---

## Daily log

Append a short bullet at the end of each day. Two lines max per day. The next-session agent should be able to read this and know exactly where things stand.

- **Mon May 4:** Shipped PR #14 locking Stacks Streams L1 schema/cursor contract, PRD resolutions, 100-event fixture, and cursor regression test.
- **Tue May 5:** —
- **Wed May 6:** —
- **Thu May 7:** —
- **Fri May 8:** —
- **Sat May 9:** —
- **Sun May 10:** —

---

## End-of-week checklist

Run through this Sunday evening before archiving.

- [ ] Did the north-star sentence become true?
- [ ] Are tasks 1–6 marked done?
- [ ] Is the L2 decoder running off Streams in staging?
- [ ] Are there any cursor or schema bugs we'd be embarrassed to ship to a paying customer? If yes, fix before week 2.
- [ ] Update `ROADMAP.md` Phase 1 progress note.
- [ ] Archive this file to `.claude/sprints/archive/2026-05-04.md`.
- [ ] Write next sprint doc covering: reorg fuzzer, convenience endpoints, hot-spare failover, status page hardening, billing meter aggregation.

---

## Notes for the next-session agent

- PRD reference: `docs/prds/0001-stacks-streams.md`. Architecture: `ARCHITECTURE.md` §L1.
- Cursor format is a 1.0 contract — do not change it without explicit approval and a migration plan.
- Streams is read-only. If a task feels like push semantics, you've drifted into the wrong product. Stop.
- Naming: it's "Stacks Streams," never "Streaming," never "Stream API."
