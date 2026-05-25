# L2 decoder backfill runbook

The decoders added go-forward — `stx_transfer`, `stx_mint`, `stx_burn`,
`stx_lock`, `ft_mint`, `ft_burn`, `nft_mint`, `nft_burn`, `print` — only hold
data since their deploy. This rewinds their checkpoints so they replay history.
(`ft_transfer`/`nft_transfer` already have full history and are excluded by
default. `contract_calls` reads the transactions table directly and is already
historical — nothing to do there.)

Tool: `packages/indexer/src/l2/reset-checkpoints.ts` (dry-run by default; writes
only with `--apply`). It sets each decoder's `l2_decoder_checkpoints.last_cursor`
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
  decoder service `l2-decoder` (container `secondlayer-l2-decoder-1`).

## Procedure (race-free)

Stop the decoder first so it can't overwrite the checkpoint mid-reset.

```bash
# 1. Pause the decoder
docker compose stop l2-decoder

# 2. Dry-run — review each decoder's  old cursor -> new cursor  (no writes)
docker compose run --rm l2-decoder \
  bun run packages/indexer/src/l2/reset-checkpoints.ts --days 90

# 3. Apply once the dry-run looks right
docker compose run --rm l2-decoder \
  bun run packages/indexer/src/l2/reset-checkpoints.ts --days 90 --apply

# 4. Resume — decoders replay from the new checkpoint
docker compose start l2-decoder

# 5. Watch progress (per-decoder writes_per_minute, checkpoint, lag_seconds)
docker compose logs -f l2-decoder | grep l2_decoder.progress
```

`docker compose run --rm l2-decoder` starts a throwaway container with the
decoder's exact env (DB connection) and overrides the command — it does **not**
start the long-running service.

Backfill is done when each decoder's `lag_seconds` is back near 0 (caught up to
tip). The `print` decoder is the slowest — it's the highest-volume type.

## Recommended: do it in groups

Running all nine replays at once hammers the Streams API and DB. Reset the
cheap types first, let them catch up, then `print` on its own:

```bash
# Group A — STX + token mints/burns + lock
docker compose run --rm l2-decoder \
  bun run packages/indexer/src/l2/reset-checkpoints.ts --days 90 --apply \
  --decoders l2.stx_transfer.v1,l2.stx_mint.v1,l2.stx_burn.v1,l2.stx_lock.v1,l2.ft_mint.v1,l2.ft_burn.v1,l2.nft_mint.v1,l2.nft_burn.v1

# …let those catch up (watch lag_seconds), then:

# Group B — print (highest volume)
docker compose run --rm l2-decoder \
  bun run packages/indexer/src/l2/reset-checkpoints.ts --days 90 --apply \
  --decoders l2.print.v1
```

(Restart `l2-decoder` after each `--apply` if you didn't stop it, or run the
whole thing with the service stopped and start it once at the end.)

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--days N` | `90` | Window from tip, by block timestamp |
| `--from-height H` | — | Explicit start height (overrides `--days`) |
| `--decoders a,b,c` | the 9 go-forward decoders | Comma-separated subset |
| `--apply` | off (dry-run) | Actually write the checkpoints |

## Verify

Once caught up, the new history is queryable:

```bash
curl "https://api.secondlayer.tools/v1/index/events?event_type=stx_transfer&from_height=<low>&limit=1"
curl "https://api.secondlayer.tools/v1/index/events?event_type=print&from_height=<low>&limit=1"
```

## Notes / safety

- **Idempotent.** Re-running is safe; upserts on `cursor`.
- **Recent data lags during replay** for the types being backfilled — the
  decoder is busy with history until it catches back up to tip.
- **To abort a replay:** stop `l2-decoder`, re-run the tool with
  `--from-height <current-tip>` `--apply` to fast-forward the checkpoint, then
  start it. (Find tip: `curl https://api.secondlayer.tools/v1/index | jq` shows
  it, or query `SELECT max(height) FROM blocks WHERE canonical`.)
- Going **full genesis** instead of a window: `--from-height 1` — expect many
  hours and large storage growth, especially for `print`.
