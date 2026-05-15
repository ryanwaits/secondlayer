# Launch smoke — prod /v1 (2026-05-15)

Base: `https://api.secondlayer.tools`. Method: curl, no auth, 1 warmup pass + 3 measurement runs, median latency. Budget: p50 < 500ms, non-empty rows.

## Results

| Endpoint | Status | Median latency | Rows | Budget |
|---|---|---|---|---|
| `/v1/datasets/sbtc/events?limit=5` | 200 | 0.503s | 5 | over |
| `/v1/datasets/sbtc/token-events?limit=5` | 200 | 0.459s | 5 | pass |
| `/v1/datasets/pox-4/calls?limit=5` | 200 | 0.551s | 5 | over |
| `/v1/datasets/bns/names?limit=5` | 200 | 0.581s | 5 | over |
| `/v1/datasets/bns/name-events?limit=5` | 200 | 0.504s | 5 | over |
| `/v1/datasets/stx-transfers?limit=5` | 200 | 0.486s | 5 | pass |
| `/v1/datasets/network-health/summary` | 200 | 1.491s | 14 days | over (aggregation) |
| `/v1/index/ft-transfers?limit=5` | **401** | 0.584s | — | **FAIL** |
| `/v1/index/nft-transfers?limit=5` | **401** | 0.981s | — | **FAIL** |

## Findings

### 🔴 ft-transfers + nft-transfers require auth (`AUTHENTICATION_ERROR`)

Memory (`project_may_27_launch_sprint`) lists these as "ft / nft transfers ✅ live (always-on)" — but prod returns 401 without an `Authorization` header. Code in `packages/api/src/routes/index.ts:52,68` imports from `../index/auth.ts`.

**Decision needed before launch:** are these intentionally gated behind `sk-sl_*` keys, or should they match the rest of the Foundation Datasets shelf and be open? Launch marketing claims 5 free datasets; if 2 of them require signup, the copy is wrong.

### 🟡 Latency borderline on most row endpoints

Median 0.46s–0.58s for the 6 row endpoints. 4 of 6 are over the 500ms p50 budget — by 1ms to 80ms. Not user-visible failure, but no headroom under load.

### 🟡 network-health/summary at 1.5s

Multi-day aggregation, expected to be slower. Worth a follow-up cache / pre-computed daily rollup post-launch.

## Go/no-go

**Soft-go for launch.** All 7 dataset endpoints return correct row shapes with live data. ft/nft 401 is a copy/policy question, not a system failure. Latencies are usable.

## Sample shapes

- Dataset envelope: `{ events|names|namespaces|calls|transfers|days: [...], next_cursor, tip }`
- 401 envelope: `{ "error": "Missing or invalid Authorization header", "code": "AUTHENTICATION_ERROR" }`
