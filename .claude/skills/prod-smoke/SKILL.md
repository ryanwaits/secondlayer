---
name: prod-smoke
description: Run a production smoke sweep against secondlayer prod — container health, husk canaries, decoder lags, op queue budgets, public subgraph reads, balance conservation, known-bug regression probes. Use when the user runs "/prod-smoke", asks to "smoke test prod", "check prod health", "is everything running smoothly", or "verify the subgraphs".
---

# Prod Smoke — secondlayer production sweep

Read-only sweep; report a single scorecard. NEVER restart, trigger, or mutate.
SSH: `ssh app-server '<cmd>'` / `ssh node-server '<cmd>'` — direct, no jump host.
(Both hosts are in `~/.ssh/config`; each machine authenticates with its own key. An
older revision of this skill hopped through `ssh ryan@claude-mini`, which fails from
any machine that cannot reach the mini — if you see that pattern anywhere, it is stale.)
API: https://api.secondlayer.tools.
Topology + runbooks: `docker/PRODUCTION.md`. CI's deploy-time twin: `scripts/ci/post-deploy-smoke.sh`
(this skill is the anytime + deeper version — don't duplicate its envelope checks, go past them).

**Before flagging API failures**: `gh run list --workflow deploy.yml --limit 1` — every push
to main deploys with a 1–2 min 502 window. A deploy `in_progress` explains transient 502s.

## Phase 1 — infrastructure

```bash
docker ps -a --format '{{.Names}} {{.Status}}'
```
Expected inventory (see PRODUCTION.md): exactly **2 api replicas** (`secondlayer-api-<N>`,
N increments per deploy — the suffix value is meaningless), all others singletons,
`migrate` as `Exited (0)`. Anything else exited/restarting = flag.

```bash
# Husk canaries — count(*), NEVER min/max (a husk shows plausible ranges).
# Chain: ≥ 8,250,000 blocks and max(height) within ~100 of now (5s blocks).
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAc 'SELECT count(*), max(height) FROM blocks'
# Platform: accounts ≥ 3, api_keys ≥ 12 (floors as of 2026-08). NOT growth-only —
# prod was deliberately pruned in 2026-08 (accounts 6→3, keys 13→12, balance subgraphs
# dropped). Re-baseline these numbers after any intentional prune instead of flagging.
docker exec secondlayer-postgres-platform-1 psql -U secondlayer -d secondlayer_platform -tAc 'SELECT (SELECT count(*) FROM accounts), (SELECT count(*) FROM api_keys)'
# Connections: limit 200; flag > 150. FATALs last 30m: expect 0 on both DBs.
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAc 'SELECT count(*) FROM pg_stat_activity'
docker logs secondlayer-postgres-1 --since 30m 2>&1 | grep -c FATAL
docker logs secondlayer-postgres-platform-1 --since 30m 2>&1 | grep -c FATAL
```
FATAL flavors and their meanings (all previously seen in prod):
`too many clients` → connection storm; `database "X" does not exist` → a client with
crossed host/dbname (check for swapped container IPs after a dual postgres recreate);
husk symptoms → see PRODUCTION.md rules 2–5.

## Phase 2 — data planes

```bash
# lag_seconds is None on idle settlement decoders — guard it or the comprehension throws.
docker exec secondlayer-decoder-1 curl -s localhost:3710/health | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('overall:',d['status'],'n=',len(d['decoders'])); [print(f\"  {x['decoder']:26} lag={x.get('lag_seconds')} cp={x['checkpoint']}\") for x in d['decoders'] if (x.get('lag_seconds') or 0) > 120 or x['status']!='healthy']; print('max lag:',max((x['lag_seconds'] for x in d['decoders'] if x.get('lag_seconds') is not None)))"
```
17 decoders total (was 15 pre-2026-08).

**`lag_seconds` is time since the last WRITE, not distance from tip.** During a quiet
stretch on chain the decoders have nothing to decode, `writes_recent` goes `false`,
`lag_seconds` climbs unbounded, and `status` flips to **`unhealthy` on every decoder at
once** — while checkpoints track the tip perfectly. A 2026-08 run saw all 16 tailing
decoders at `lag=459s` / overall `unhealthy`, then `healthy` again 60s later on the next
write. **Judge tip-following by `tip_block_height - checkpoint_block_height`** (steady 2 is
normal); treat a high `lag_seconds` as a finding only if that distance is ALSO growing:
```bash
# sample twice ~45s apart — checkpoint must advance ~1:1 with tip
docker exec secondlayer-decoder-1 curl -s localhost:3710/health | python3 -c "import sys,json;x=json.load(sys.stdin)['decoders'][0];print('cp',x['checkpoint_block_height'],'tip',x['tip_block_height'],'behind',x['tip_block_height']-x['checkpoint_block_height'])"
```
A synchronized `unhealthy` across ALL decoders with flat behind-distance = quiet chain.
Divergent per-decoder lags with a growing distance = a real stall.

Large lag is OK ONLY during a deliberate backfill
(`packages/indexer/src/decode/BACKFILL.md`). Known quirks:
`decode.pox4.v1` shadows the slowest replaying decoder's checkpoint — not independently
broken; `settle.sbtc.v1` reports `lag_seconds`/`checkpoint`/`tip_block_height` as `null`
because it settles on demand rather than tailing — `status: healthy` with a recent
`last_decoded_at` is the only signal it has. Neither is a finding.

```bash
# Op queue + scheduler invariants
docker exec secondlayer-postgres-platform-1 psql -U secondlayer -d secondlayer_platform -tAc \
  "SELECT subgraph_name||'|'||kind||'|'||status||'|'||weight||'|'||COALESCE(cursor_block::text,'-') FROM subgraph_operations WHERE status IN ('queued','running') ORDER BY created_at"
```
Invariants: running `heavy` ops ≤ **SUBGRAPH_HEAVY_OP_BUDGET (2)** — 3+ = scheduler bug.
A `running` op whose cursor (subgraph `last_processed_block` for reindex, op `cursor_block`
for backfill) is frozen across two checks ~15m apart = stuck → check processor logs for
`halted at block` / `cursor race lost` floods (zombie runner — see PRODUCTION.md runbook).

## Phase 3 — public API surfaces (no SSH; anon unless SL_API_KEY provided)

```bash
curl -s -o /dev/null -w '%{http_code}' https://api.secondlayer.tools/v1/subgraphs        # 200
curl -s 'https://api.secondlayer.tools/v1/index/events?event_type=ft_transfer&limit=1'   # events[0].block_height near tip
curl -s https://api.secondlayer.tools/v1/x402/supported   # x402Version:2; enabled:false is CORRECT while the rail is dormant — do NOT flag; DO flag missing freeQuota/sessions/prepaid/paidWrites keys or a catalog without 5 surfaces (streams,index,subgraph-deploy,subgraph-renew,deposit)
curl -s https://api.secondlayer.tools/.well-known/x402                                   # points at /v1/x402/supported
curl -s -o /dev/null -w '%{http_code}' https://www.secondlayer.tools/llms.txt            # 200
curl -s -o /dev/null -w '%{http_code}' https://www.secondlayer.tools/subgraphs/explore   # 200

# Every PUBLIC subgraph: detail + ALL-table read. blocks_behind > 60 (~5 min) = flag
# UNLESS sync.queue/sync.integrity says a reindex/backfill is in flight.
# NOTE: subgraph table reads REQUIRE underscore-prefixed control params — `?_limit=1`.
# A bare `?limit=1` is rejected 400 VALIDATION_ERROR by design; using it makes every
# subgraph look broken. (/v1/index/events is the opposite — it takes a bare `limit`.)
curl -s https://api.secondlayer.tools/v1/subgraphs | python3 -c "
import sys, json, urllib.request
for sg in json.load(sys.stdin).get('subgraphs', []):
    name = sg['name']
    d = json.load(urllib.request.urlopen(f'https://api.secondlayer.tools/v1/subgraphs/{name}'))
    behind = d.get('tip', {}).get('blocks_behind', '?')
    out = []
    for tb in list((d.get('tables') or {}).keys()):
        try:
            t = json.load(urllib.request.urlopen(f'https://api.secondlayer.tools/v1/subgraphs/{name}/{tb}?_limit=1'))
            out.append(f'{tb}=' + ('rows' if any(isinstance(v, list) and v for v in t.values()) else 'EMPTY'))
        except Exception as e:
            out.append(f'{tb}=FAIL {e}')
    print(f\"{name}: status={d.get('status')} behind={behind} | \" + ' '.join(out))"
```
Expected public set as of 2026-08 (5): `asset-holdings`, `sbtc-flows`, `contract-deployments`,
`pox-stacking`, `bns-names`. The balance seeds (`sbtc-balances`, `usdcx-balances`,
`alex-balances`, `sip10-balances`) were **deliberately removed** — their absence is NOT a
finding; `scripts/seed-balances/*` still ships them if they are ever redeployed.
One of the 5 above missing from the public list = flag (unpublished pending verification
is a known state — check the op queue before calling it a bug).

## Phase 4 — balance conservation (the gate that has caught four real bugs)

**Currently INAPPLICABLE — no balance subgraphs are deployed** (removed deliberately in
2026-08; verify with `SELECT schemaname FROM pg_tables WHERE tablename='balances'` on the
platform DB — empty means skip, and say "N/A, none deployed" in the scorecard rather than
✓ or ✗). Phase 4b is the load-bearing conservation gate while that holds. Everything below
applies unchanged the moment a balance subgraph is redeployed from `scripts/seed-balances/`.

For each balance subgraph that is public AND synced (skip mid-reindex):
`sum(balances) == mints − burns` **EXACTLY**, plus holder-count sanity bands.

| subgraph | contract_id | holders ballpark |
|---|---|---|
| sbtc-balances | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` | ~5–6k |
| usdcx-balances | `SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx` | ~300–500 |
| alex-balances | `SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token` | ~24k+ |

```bash
curl -s 'https://api.secondlayer.tools/v1/subgraphs/<name>/balances/aggregate?_sum=balance&_count=true'
# ledger side (SSH; amount is a COLUMN, not payload JSON; filter canonical):
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAc \
  "SELECT (SELECT COALESCE(sum(amount::numeric),0) FROM decoded_events WHERE event_type='ft_mint' AND contract_id='<cid>' AND canonical)
        - (SELECT COALESCE(sum(amount::numeric),0) FROM decoded_events WHERE event_type='ft_burn' AND contract_id='<cid>' AND canonical)"
# negative balances (uint CHECK makes this impossible; nonzero = constraint regression):
docker exec secondlayer-postgres-platform-1 psql -U secondlayer -d secondlayer_platform -tAc \
  "SELECT count(*) FROM <schema_name>.balances WHERE balance < 0"
```
ANY inequality: STOP, top-line finding, touch nothing.

## Phase 4b — chain-truth supply cross-check (catches firehose row-duplication)

Phase 4 is INTERNAL consistency: `sum(balances) == decoded mints−burns`. Both
sides derive from the same `decoded_events`, so they move together and the gate
PASSES even when both are wrong vs chain. That is exactly how the 2026-06 sBTC
shortfall hid (decoded mint−burn 2,331.6 BTC vs on-chain 2,954.7 — whole-block
`events` duplication inflated burns asymmetrically). This phase anchors to the
node's authoritative `get-total-supply` and compares THREE quantities per token:

- `chain` = node `get-total-supply` (authoritative).
- `decoded_net` = `decoded_events` ft_mint−ft_burn (canonical). **Must equal `chain`.**
- `raw_net` = DISTINCT-logical raw `events` net (dedup `(block_height,tx_id,event_index)`
  before summing). Proves the firehose itself is intact. **Must equal `chain`.**

`decoded_net != chain` while `raw_net == chain` ⇒ the row-duplication bug is live
in the decoded plane (events deduped but decoded not re-derived, or new dups).
`raw_net != chain` ⇒ firehose integrity broken (worse). Tolerance = 0 for FT
supply (exact integer sats). sbtc-token is mandatory; extend the list freely.

**PIN THE HEIGHT — the tip is live.** `chain` is read from the node at one instant and
the DB sums at another, and the decoder trails the firehose by ~50s, so an unpinned
comparison shows a spurious shortfall equal to whatever minted in the gap (a 2026-08 run
reported 109,225 sats "missing" this way — it was pure sampling skew, not the 2026-06 bug).
Pick `H` ≈ 50 blocks below tip, bound BOTH DB sides with `block_height <= H`, and only
then compare. `chain` at tip legitimately exceeds a pinned `decoded_net`/`raw_net` by the
net minted since `H`; what must match EXACTLY is `decoded_net == raw_net` at the same `H`.
To assert against `chain` exactly, re-read `get-total-supply` with `?tip=<hash at H>`.

```bash
CID='SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token'
ASSET="${CID}::sbtc-token"; ADDR="${CID%.*}"; NAME="${CID#*.}"
API=$(ssh app-server 'docker ps --format {{.Names}} | grep -m1 secondlayer-api')
H=$(ssh app-server 'docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAc "SELECT max(height)-50 FROM blocks"')

# chain — node get-total-supply. Pipe the curl script to `sh` over stdin (NOT as a
# nested `sh -c` arg — the triple quoting mangles the JSON body). $STACKS_NODE_RPC_URL
# expands inside the container. result hex = 0x07(ok)+01(uint)+16B BE → int(hex[6:]).
chain=$(printf '%s\n' "curl -s -m 25 -X POST \"\$STACKS_NODE_RPC_URL/v2/contracts/call-read/$ADDR/$NAME/get-total-supply\" -H 'Content-Type: application/json' -d '{\"sender\":\"$ADDR\",\"arguments\":[]}'" \
  | ssh app-server "docker exec -i $API sh" \
  | python3 -c "import sys,json;print(int(json.load(sys.stdin)['result'][6:],16))")

# decoded_net (the buggy plane) and raw_net (deduped firehose, authoritative) — BOTH at H
read decoded_net raw_net <<<$(printf '%s\n' "
select
 (select coalesce(sum(amount::numeric),0) from decoded_events where event_type='ft_mint' and contract_id='$CID' and canonical and block_height <= $H)
-(select coalesce(sum(amount::numeric),0) from decoded_events where event_type='ft_burn' and contract_id='$CID' and canonical and block_height <= $H),
 (with d as (select distinct e.block_height,e.tx_id,e.event_index,e.type,(e.data->>'amount')::numeric amt from events e join blocks b on b.height=e.block_height where b.canonical and e.block_height <= $H and e.data->>'asset_identifier'='$ASSET' and e.type in ('ft_mint_event','ft_burn_event'))
  select coalesce(sum(amt) filter (where type='ft_mint_event'),0)-coalesce(sum(amt) filter (where type='ft_burn_event'),0) from d);
" | ssh app-server 'docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAF" "')

echo "sbtc H=$H chain@tip=$chain decoded_net@H=$decoded_net raw_net@H=$raw_net"
# assert decoded_net == raw_net EXACTLY; chain - decoded_net = net minted in (H, tip] and
# should be small and positive-ish. A LARGE or negative gap vs chain is the real signal.
```
`decoded_net != raw_net` at the same `H`: STOP, top-line finding, touch nothing.

Do NOT extend this into a per-type (gross mint vs gross burn) comparison and treat a
mismatch as a bug without checking the net first. The decoded and raw sides are selected
by different predicates — decoded by `contract_id`, raw by `data->>'asset_identifier'` —
so their gross row counts and sums legitimately diverge while the net is exact. A 2026-08
run saw decoded ft_mint 11,055 rows / 1,230,901,478,297 vs raw 8,560 / 741,317,628,409 and
decoded ft_burn exactly 2× raw, with the excess forming one mint+burn pair per raw burn
that cancels in net. All 16,045 decoded positions were distinct (no PK duplication) and
`decoded_net == raw_net` exactly. Unresolved whether that is paired double-decode or the
predicate mismatch; the decisive query below times out at 5m and needs bucketing:
```sql
SET statement_timeout=0;  -- then bucket by 100k on block_height
SELECT count(*) FROM decoded_events d
WHERE d.contract_id='<cid>' AND d.canonical AND d.event_type='ft_burn'
  AND d.block_height BETWEEN <lo> AND <hi>
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.block_height=d.block_height
                  AND e.tx_id=d.tx_id AND e.event_index=d.event_index AND e.type='ft_burn_event');
```

## Phase 5 — known-bug regression probes (each one a past prod incident)

```bash
# 1. Accumulator guard holds (422, NOT a queued op — needs SL_API_KEY w/ owner rights):
#    N/A while no balance subgraph is deployed (see Phase 4) — the target 404s, which is
#    NOT evidence the guard regressed. Skip unless one has been redeployed AND a key exists.
curl -s -X POST -H "Authorization: Bearer $SL_API_KEY" -H 'Content-Type: application/json' \
  -d '{"fromBlock":100,"toBlock":200}' https://api.secondlayer.tools/api/subgraphs/sbtc-balances/backfill
# expect code BACKFILL_NON_REPLAYABLE_HANDLER. Skip if no key provided.

# 2. Increment/CHECK regression marker: any balance reindex halted at exactly
#    341445 (sbtc), 5269728 (usdcx), or 45563 (alex) = the ON CONFLICT footgun is back.
#    Cheap and still worth running — it scans op history, not a live subgraph.
docker exec secondlayer-postgres-platform-1 psql -U secondlayer -d secondlayer_platform -tAc \
  "SELECT subgraph_name, left(error,80) FROM subgraph_operations WHERE status='failed' AND error LIKE '%balance_check%' AND finished_at > now() - interval '24 hours'"

# 3. Slack watcher quiet — `secondlayer-agent` is NOT part of the compose stack on
#    app-server as of 2026-08. If `docker ps -a` has no such container, report N/A;
#    a missing container is not a silent-watcher finding.
docker logs secondlayer-agent --since 2h 2>&1 | grep -iE 'Pattern:|alert' | tail -5

# 4. Reorg reconciliation — no stale old-fork rows survive in decoded_events.
#    A reorg hard-DELETEs decoded_events >= fork (handleDecodedEventsReorg, storage.ts);
#    before that fix a flag-only mark + later re-derive resurrected residue on SHIFTED
#    dense cursors (the 2026-05-26 reorg left 57 tx-absent orphans + a +152,062-sat sBTC
#    over-count; the 2026-05-07 reorg left 75 dup-on-shifted-cursor rows whose tx WAS
#    still canonical). Probe both shapes at once: per (block,tx) in a recorded reorg
#    window, decoded-row count must be ≤ raw streams-event count (excess = stale, covers
#    orphans AND dups; ≤ never false-positives on disabled decoders or decode-skips).
#    MUST be 0. Drives off chain_reorgs (15 rows as of 2026-08, oldest 2026-05-07, most
#    single-block) → index range scans over a few dozen blocks total, returns in seconds; a
#    bare `JOIN ... BETWEEN` over the 57M table seq-scans, do NOT use it. The supply side
#    of the same residue is also gated by Phase 4b decoded_net vs chain.
RAW="'stx_transfer_event','stx_mint_event','stx_burn_event','stx_lock_event','ft_transfer_event','ft_mint_event','ft_burn_event','nft_transfer_event','nft_mint_event','nft_burn_event','smart_contract_event','contract_event'"
printf '%s\n' "
SELECT coalesce(sum(greatest(d.cnt - coalesce(r.cnt,0),0)),0) AS stale_excess
FROM (
  SELECT de.block_height, de.tx_id, count(*) cnt
  FROM chain_reorgs cr CROSS JOIN LATERAL (
    SELECT block_height, tx_id FROM decoded_events
    WHERE block_height BETWEEN cr.fork_point_height AND cr.orphaned_to_height
  ) de GROUP BY 1,2
) d
LEFT JOIN LATERAL (
  SELECT count(*) cnt FROM events e
  WHERE e.block_height=d.block_height AND e.tx_id=d.tx_id AND e.type IN ($RAW)
) r ON true;" | ssh app-server 'docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tA'
# Nonzero ⇒ a reorg left residue (UPSERT-without-delete bug back, or a new reorg hit a
# pre-fix decoder). Realign the window with rederive-decoded-events.ts (--types from a
# `GROUP BY event_type` over the range first), then re-run this + Phase 4b.
#
# LIMITATION + DEEP SCAN: this is bounded to chain_reorgs (handleReorg-recorded reorgs).
# Older reorgs predating that table left supply-NEUTRAL misattributions (a decoded row at
# a stale height; cancels in net, untouched by Phase 4 / 4b). To sweep them, run the same
# d>r check unbounded over a height range (minutes — NOT part of the fast gate, prepend
# `SET statement_timeout=0;`): replace the `chain_reorgs cr CROSS JOIN LATERAL (… WHERE
# block_height BETWEEN cr.fork_point_height AND cr.orphaned_to_height)` driver with
# `decoded_events WHERE block_height BETWEEN <lo> AND <hi>`, bucket by 100k.
```

## Report format

```
## Prod Smoke — <date>

Infra:        ✓/✗ (containers / canaries / connections / FATALs)
Data planes:  ✓/✗ (decoder lags / queue budget / stuck ops)
Public API:   ✓/✗ (N public subgraphs read; surfaces)
Conservation: ✓/✗/N-A per token (Phase 4 N/A while no balance subgraphs; chain-truth decoded_net == raw_net at pinned H; exact deltas on ✗)
Regressions:  ✓/✗/N-A (guard 422 / kill-block markers / watcher / reorg orphans=0)

Flags: <ambiguous, slow, or trending-wrong items + the exact command to dig deeper>
```
Report SKIPPED and N/A probes explicitly — a scorecard that silently omits them reads as
"all green" when parts of the gate never ran.

## Rules
- Read-only. Report and stop — remediation is a separate, human-approved step.
- Conservation or husk-canary failure is ALWAYS the top-line finding.
- Distinguish "broken" from "mid-backfill/mid-deploy" before flagging (op queue + gh run list).
- Distinguish "broken" from "deliberately removed" too — prod was pruned in 2026-08. A
  count below a floor written here is a stale floor until proven otherwise; ask before flagging.
- Before reporting ANY numeric mismatch against a live chain, re-run it pinned to a fixed
  block height. Tip-race skew has produced a false conservation failure before.
- Holder counts shrinking vs the bands, or a previously-public seed going 404, are findings even if everything else is green.
