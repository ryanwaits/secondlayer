# L2 decoder backfill runbook

> **STATUS (2026-06-21) — RESOLVED. All decoders are genesis-complete.**
> The go-forward decoders (`stx_*`, `nft_*`, `print`) were floored at ~6.8M (added
> after Streams, never backfilled). Fixed via the **firehose backfill** — see
> `backfill-from-firehose.ts`, NOT the `reset-checkpoints` path below. The firehose
> reads the indexer DB on a SEPARATE checkpoint namespace (`backfill.<key>`), so
> the live decoders stay at tip with **zero lag** while the backfill replays
> genesis→tip in parallel (the old `reset-checkpoints` approach rewinds the LIVE
> checkpoint and lags the decoder for the whole run — only acceptable for low-stakes
> one-offs). Final floor audit: every decoder at its genesis/deploy floor, ~49M
> events backfilled, 0 errors.
>
> **Regression guard:** `floor-audit.ts` (`bun run src/decode/floor-audit.ts`)
> asserts each enabled decoder's floor stays at its recorded genesis baseline, and
> FAILS on any new decoder missing from `DECODER_FLOOR_BASELINE`. Run it in CI / on
> deploy so a future go-forward decoder can't silently ship floored again.
>
> The `reset-checkpoints` runbook below remains valid for **targeted** rewinds
> (e.g. re-deriving a specific decoder over a reorg window), but is NOT the way to
> backfill a floored decoder — use the firehose path.

The decoders added go-forward — `stx_transfer`, `stx_mint`, `stx_burn`,
`stx_lock`, `ft_mint`, `ft_burn`, `nft_mint`, `nft_burn`, `print` — only hold
data since their deploy. This rewinds their checkpoints so they replay history.
(`ft_transfer`/`nft_transfer` already have full history and are excluded by
default. `contract_calls` reads the transactions table directly and is already
historical — nothing to do there.)

Tool: `packages/indexer/src/decode/reset-checkpoints.ts` (dry-run by default; writes
only with `--apply`). It sets each decoder's `decoder_checkpoints.last_cursor`
to `<startHeight>:0`; on its next poll each decoder replays from there. Writes
are idempotent upserts, so re-processing the recent tail is harmless.

**Decision baked in:** ~90-day window. Override with `--days N` or
`--from-height H`.

## Prerequisites

- The commit that adds `reset-checkpoints.ts` + `stx_lock` is **deployed** (so
  the script and the `stx_lock` decoder are in the running image).
- SSH access to the prod host, and you're in the directory with
  `docker-compose.yml` (where `docker compose …` resolves the project).
- Confirm container/service names if unsure: `docker compose ps` — expect the
  decoder service `decoder` (container `secondlayer-decoder-1`).

## Step 0 — clean reorg dupes first (#46, required)

Before backfilling, remove the reorg-orphaned duplicate transactions/events that
caused the Streams cursor collisions. Run this once, after the replace-per-height
ingest fix is deployed (so no new dupes form), and before the backfill below:

```bash
# dry-run — reports orphaned tx / event counts, no writes
docker compose run --rm decoder \
  bun run packages/indexer/src/cleanup-reorg-dupes.ts

# apply
docker compose run --rm decoder \
  bun run packages/indexer/src/cleanup-reorg-dupes.ts --apply
```

Expect `remaining orphaned transactions: 0` after `--apply`. (Optional
`--from-height` / `--to-height` to scope.) Then proceed to the backfill.

## Procedure (race-free)

Stop the decoder first so it can't overwrite the checkpoint mid-reset.

```bash
# 1. Pause the decoder
docker compose stop decoder

# 2. Dry-run — review each decoder's  old cursor -> new cursor  (no writes)
docker compose run --rm decoder \
  bun run packages/indexer/src/decode/reset-checkpoints.ts --days 90

# 3. Apply once the dry-run looks right
docker compose run --rm decoder \
  bun run packages/indexer/src/decode/reset-checkpoints.ts --days 90 --apply

# 4. Resume — decoders replay from the new checkpoint
docker compose start decoder

# 5. Watch progress (per-decoder writes_per_minute, checkpoint, lag_seconds)
docker compose logs -f decoder | grep decoder.progress
```

`docker compose run --rm decoder` starts a throwaway container with the
decoder's exact env (DB connection) and overrides the command — it does **not**
start the long-running service.

Backfill is done when each decoder's `lag_seconds` is back near 0 (caught up to
tip). The `print` decoder is the slowest — it's the highest-volume type.

## Recommended: do it in groups

Running all nine replays at once hammers the Streams API and DB. Reset the
cheap types first, let them catch up, then `print` on its own:

```bash
# Group A — STX + token mints/burns + lock
docker compose run --rm decoder \
  bun run packages/indexer/src/decode/reset-checkpoints.ts --days 90 --apply \
  --decoders decode.stx_transfer.v1,decode.stx_mint.v1,decode.stx_burn.v1,decode.stx_lock.v1,decode.ft_mint.v1,decode.ft_burn.v1,decode.nft_mint.v1,decode.nft_burn.v1

# …let those catch up (watch lag_seconds), then:

# Group B — print (highest volume)
docker compose run --rm decoder \
  bun run packages/indexer/src/decode/reset-checkpoints.ts --days 90 --apply \
  --decoders decode.print.v1
```

(Restart `decoder` after each `--apply` if you didn't stop it, or run the
whole thing with the service stopped and start it once at the end.)

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--days N` | `90` | Window from tip, by block timestamp |
| `--from-height H` | — | Explicit start height (overrides `--days`) |
| `--decoders a,b,c` | the 9 go-forward decoders | Comma-separated subset |
| `--apply` | off (dry-run) | Actually write the checkpoints |

## Verify

Run these to confirm the backfill is progressing / done and the system is
healthy. The decoder checks run on the prod host (`ssh ryan@claude-mini` →
`ssh app-server`); the API checks run from anywhere.

**1. Decoders caught up + healthy** (the main check). Want `overall: healthy`
and every `decode.*` decoder's `lag_seconds` small (tens-to-low-hundreds = at tip).
Dense types (`stx_transfer`, `print`) finish last.

```bash
docker exec secondlayer-decoder-1 curl -s localhost:3710/health \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('overall:', d['status']); [print(f\"  {x['decoder']:22} {x['status']:9} lag={x['lag_seconds']}s\") for x in d['decoders']]"
```

**2. Watch live progress** (per-decoder writes_per_minute / checkpoint / lag):

```bash
docker logs -f secondlayer-decoder-1 | grep decoder.progress
```

**3. No decoder errors** (expect empty):

```bash
docker logs --since 2h secondlayer-decoder-1 2>&1 | grep "decoder.error" | tail
```

**4. Replace-per-height holding — no new reorg dupes** (read-only, expect 0):

```bash
docker exec secondlayer-decoder-1 \
  bun run packages/indexer/src/cleanup-reorg-dupes.ts   # → "orphaned transactions: 0"
```

**5. API serving backfilled history** (run anywhere, once lag → 0). A height
well inside the window should return rows:

```bash
curl "https://api.secondlayer.tools/v1/index/events?event_type=stx_transfer&from_height=7200000&to_height=7200100&limit=3"
curl "https://api.secondlayer.tools/v1/index/events?event_type=print&from_height=7200000&to_height=7200100&limit=1"
curl "https://api.secondlayer.tools/v1/index/events?event_type=stx_lock&from_height=7200000&limit=1"
```

**All good** = #1 healthy with small lags, #3 empty, #4 reports 0, #5 returns
historical rows.

## Notes / safety

- **Idempotent.** Re-running is safe; upserts on `cursor`.
- **Recent data lags during replay** for the types being backfilled — the
  decoder is busy with history until it catches back up to tip.
- **To abort a replay:** stop `decoder`, re-run the tool with
  `--from-height <current-tip>` `--apply` to fast-forward the checkpoint, then
  start it. (Find tip: `curl https://api.secondlayer.tools/v1/index | jq` shows
  it, or query `SELECT max(height) FROM blocks WHERE canonical`.)
- Going **full genesis** instead of a window: `--from-height 1` — expect many
  hours and large storage growth, especially for `print`.
