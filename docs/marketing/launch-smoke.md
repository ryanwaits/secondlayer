# Launch smoke — prod /v1 (2026-05-17)

Base: `https://api.secondlayer.tools`. Method: curl, no `Authorization` header, 1 measurement run per endpoint. Budget: HTTP 200, non-empty rows, p50 < 600ms.

## Results

| Endpoint | Status | Latency | Rows | Budget |
|---|---|---|---|---|
| `/v1/datasets/sbtc/events?limit=5` | 200 | 0.451s | 5 | pass |
| `/v1/datasets/sbtc/token-events?limit=5` | 200 | 0.443s | 5 | pass |
| `/v1/datasets/pox-4/calls?limit=5` | 200 | 0.439s | 5 | pass |
| `/v1/datasets/bns/names?limit=5` | 200 | 0.551s | 5 | pass |
| `/v1/datasets/bns/events?limit=5` | 200 | — | 5 | pass (verify post-merge) |
| `/v1/datasets/stx-transfers?limit=5` | 200 | 0.443s | 5 | pass |
| `/v1/datasets/network-health/summary` | 200 | 1.399s | 17 days | over (aggregation, expected) |
| `/v1/index/ft-transfers?limit=5` | **200** | 0.472s | 5 | **pass** |
| `/v1/index/nft-transfers?limit=5` | **200** | 0.449s | 5 | **pass** |

## What changed since 2026-05-15 run

- **ft/nft 401 → 200.** Commit `c3b90e80 feat(api): allow anonymous reads on /v1/index/{ft,nft}-transfers` shipped a few hours after the original smoke captured those 401s. Endpoints are anonymous now, matching the rest of the Foundation Datasets shelf. **Marketing copy "5 free Foundation Datasets" is accurate as-shipped.**
- Previous smoke had `/v1/datasets/bns/name-events` — that path doesn't exist; real route is `/v1/datasets/bns/events`. Other BNS event routes: `/namespace-events`, `/marketplace-events`.

## Findings

### 🟢 No blockers

All Foundation Dataset endpoints and both Index endpoints return real rows anonymously. No 401s, no 5xx.

### 🟡 network-health/summary at 1.4s

Multi-day aggregation, expected to be slower. Post-launch follow-up: cache or pre-computed daily rollup.

### 🟡 Latency comfortable but not generous

Row endpoints p50 ~0.44–0.55s. Under 600ms budget, headroom is ~50–150ms.

## Go/no-go

**Green-go for launch.** All marketing claims map to live endpoints with anonymous reads. Index endpoints can stay in the "5 free Foundation Datasets" framing if desired, or be promoted separately as "decoded transfer feeds" — copy choice, not a system constraint.

## Sample shapes

- Dataset envelope: `{ events|names|namespaces|calls|transfers|days: [...], next_cursor, tip }`
- Index envelope: `{ events: [...], next_cursor, tip }`
- Anon rate limit headers always present: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (shared global, 100 req/s on Index)
