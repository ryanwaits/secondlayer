# Sprint 0 — subgraph sync source benchmark: DB-tap vs HTTP (Index)

Goal: before re-pointing subgraphs off the indexer Postgres onto the public Index/Streams APIs, measure whether HTTP sync can be as fast as the in-cluster DB tap (core value prop = extremely fast syncing).

All runs **in-cluster** on app-server inside `secondlayer-subgraph-processor-1` (same host/network as Postgres + `api:3800`), mainnet. DB-tap = `loadBlockRange(getSourceDb(),…)`. HTTP = SDK `Index` client (`/v1/index/blocks` + `/events` + `/contract-calls`), anon read, page size 1000.

## Headline
**Naive HTTP backfill is NOT fundamentally slower — but it currently collapses on high-volume event types (esp. `print`) due to a specific, fixable server-side query bug.** The Index server's *first* page is fast (~30k events/sec); every *cursor-paginated* page re-scans the entire event-type partition. Fix the index/keyset and HTTP backfill should approach DB-tap speed.

## Numbers

### Sparse range 7,000,000–7,002,000 (2001 blocks, ~4.4k events)
| path | blocks/sec | events/sec | wall |
|---|---|---|---|
| DB-tap | 17,499 | 38,706 | 0.11s |
| HTTP `stx_transfer,print` cold | 20,750 | 32,301 | 0.10s |
| HTTP warm | 20,708 | 32,236 | 0.10s |

→ With little data, HTTP ≈ DB (even slightly faster — fewer round-trips). Cache delta ~0.

### Dense range 8,100,000–8,102,000 (2001 blocks, 61,933 events; ~31 ev/blk)
| path | blocks/sec | events|calls/sec | wall |
|---|---|---|---|
| DB-tap (all 61,933 events) | **1,865** | 57,729 | 1.07s |
| HTTP `print` (33,218) cold | **28** | 458 | **72.5s** |
| HTTP `print` warm | 27 | 447 | 74.3s |
| HTTP `ft_transfer` (5,759) | 3,815–3,992 | ~11,000 | 0.5s |
| HTTP `contract-calls` (9,168) | 708–850 | 2,038–2,446 | 2.4–2.8s |

→ `print` HTTP = **~67× slower blocks/sec, ~126× slower events/sec** than DB-tap. Warm cache gave **zero** benefit. But `ft_transfer` over HTTP was fast (~11k events/sec). So the collapse is **type-specific**, not general to HTTP.

### Per-page timing (`/v1/index/events?event_type=print`, limit 1000)
| page | mode | time |
|---|---|---|
| 1 | `from_height` (range) | **51 ms** |
| 2–6 | `cursor` (keyset) | **~6,800 ms each** |

Single-page `curl` (page 1, height filter) = **33 ms** for a 1 MB / 1000-row print page. The slowness is **only** the cursor-continuation pages.

## Root cause (EXPLAIN ANALYZE confirmed)
The events reader (`packages/api/src/index/events.ts:294-304`) paginates with a **non-sargable OR keyset**:
```sql
(block_height > X OR (block_height = X AND event_index > Y))
```
With no composite index on `(event_type, block_height, event_index)`, the planner BitmapAnds the single-column `decoded_events_event_type_idx` — **scanning all 4,217,722 `print` rows in history on every page** (`actual rows=4217722`). Page 1 (no keyset) avoids this via the block_height range index → 51 ms. Existing composites `(contract_id|sender|recipient, block_height, event_index)` are exactly why contract/sender/asset-filtered queries are fast; a **bare event-type** source has no matching composite.

Decoded_events indexes today: `event_type` (alone), `block_height` (alone), `(contract_id|sender|recipient, block_height, event_index)`, `(event_type, canonical, created_at DESC)` — none serve `(event_type, block_height, event_index)` keyset pagination.

## Fix (concrete, low-risk)
1. **Composite index** (the real fix; mirrors existing composites + the prior l2-health decoded_events index incident):
   ```sql
   CREATE INDEX CONCURRENTLY decoded_events_type_height_event_idx
     ON decoded_events (event_type, block_height, event_index) WHERE canonical;
   ```
2. **Tuple keyset** (sargable form) in `events.ts`:
   ```sql
   (block_height, event_index) > (X, Y)
   ```
3. (minor) the per-row correlated `block_time` subquery (`events.ts:326-332`) could be a single join.

Expected: cursor pages drop from ~6.8s to low-ms (index range scan), HTTP backfill → ~tens of thousands of events/sec, approaching DB-tap.

### After (proven on prod)
Index built `CONCURRENTLY` on prod + `EXPLAIN ANALYZE` of the tuple-keyset query:
```
Index Only Scan using decoded_events_type_height_event_idx
  Index Cond: event_type='print' AND block_height IN [..] AND ROW(block_height,event_index) > ROW(8100196,31)
  Heap Fetches: 0   Execution Time: 0.373 ms
```
→ **6,800ms → 0.37ms per page** (~18,000×), index-only. NOTE: **both** changes are required — the index alone (with the old OR keyset still deployed) only got ~2× (72.5s→39.7s) because the OR form stays non-sargable. With the tuple keyset deployed, per-page DB time is sub-ms and network/parse (~30–50ms/page) becomes the floor → ~30k events/sec, at/above DB-tap. Shipped as migration `0087_decoded_events_type_height_event_idx.ts` + the `events.ts` keyset rewrite.

## Recommendation → Branch C, then proceed
HTTP/Index is a **viable** subgraph source on perf grounds — the regression is one missing index + a keyset rewrite, not an architectural limit. Sequence:
1. Ship the `decoded_events` composite index + tuple-keyset fix (small, also speeds up existing bare-event-type Index API consumers).
2. **Re-run this bench** on the dense range; confirm HTTP print ≈ DB-tap.
3. If confirmed, proceed with the full re-point (`BlockSource` seam, Streams clock + Index data) per the parent plan.

## Not yet measured / caveats
- **Tip-tail latency (S0.T4)** not separately measured; tip volume is tiny (one block) so not the perf-critical path — defer precise numbers.
- **Raw-row reconstruction cost** excluded (data-acquisition ceiling only). Adds CPU on the HTTP path; measure after the index fix.
- HTTP numbers exclude metering (anon read, no account_id). The internal seed key must also be account_id-less to stay unmetered.
- Bench scripts: `db-tap.ts`, `http-source.ts` (+ ephemeral `pageprobe.ts`). Run via `docker exec … bun run packages/subgraphs/bench/<script> --from H1 --to H2 …`.
</content>
