---
name: prod-smoke
description: Run a production smoke sweep against secondlayer prod — container health, husk canaries, decoder lags, op queue budgets, public subgraph reads, balance conservation, known-bug regression probes. Use when the user runs "/prod-smoke", asks to "smoke test prod", "check prod health", "is everything running smoothly", or "verify the subgraphs".
---

# Prod Smoke — secondlayer production sweep

Read-only sweep; report a single scorecard. NEVER restart, trigger, or mutate.
SSH: `ssh ryan@claude-mini "ssh app-server '<cmd>'"`. API: https://api.secondlayer.tools.
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
# Platform: accounts ≥ 6, api_keys ≥ 13 (floors as of 2026-06; growth-only).
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
docker exec secondlayer-l2-decoder-1 curl -s localhost:3710/health | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('overall:', d['status']); [print(f\"  {x['decoder']:22} lag={x['lag_seconds']}s cp={x['checkpoint'].split(':')[0]}\") for x in d['decoders'] if x['lag_seconds'] > 120]"
```
15 decoders total. Lag in tens of seconds = at tip. Large lag is OK ONLY during a
deliberate backfill (`packages/indexer/src/l2/BACKFILL.md`). Known quirk: `l2.pox4.v1`
shadows the slowest replaying decoder's checkpoint — not independently broken.

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

# Every PUBLIC subgraph: detail + first-table read. blocks_behind > 60 (~5 min) = flag
# UNLESS sync.queue/sync.integrity says a reindex/backfill is in flight.
curl -s https://api.secondlayer.tools/v1/subgraphs | python3 -c "
import sys, json, urllib.request
for sg in json.load(sys.stdin).get('subgraphs', []):
    name = sg['name']
    d = json.load(urllib.request.urlopen(f'https://api.secondlayer.tools/v1/subgraphs/{name}'))
    behind = d.get('tip', {}).get('blocks_behind', '?')
    tables = list((d.get('tables') or {}).keys())
    row = '-'
    if tables:
        t = json.load(urllib.request.urlopen(f'https://api.secondlayer.tools/v1/subgraphs/{name}/{tables[0]}?limit=1'))
        row = 'rows' if any(isinstance(v, list) and v for v in t.values()) else 'EMPTY'
    print(f\"{name}: status={d.get('status')} behind={behind} first_table={row}\")"
```
Curated seeds that should be public once verified: `sbtc-flows`, `pox-stacking`,
`bns-names`, `sip10-balances`, `sbtc-balances`, `usdcx-balances`, `alex-balances`.
A FEATURED seed missing from the public list = flag (unpublished pending verification
is a known state — check the op queue before calling it a bug).

## Phase 4 — balance conservation (the gate that has caught four real bugs)

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

```bash
CID='SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token'
ASSET="${CID}::sbtc-token"; ADDR="${CID%.*}"; NAME="${CID#*.}"
API=$(ssh ryan@claude-mini "ssh app-server 'docker ps --format {{.Names}} | grep -m1 secondlayer-api'")

# chain — node get-total-supply. Pipe the curl script to `sh` over stdin (NOT as a
# nested `sh -c` arg — the triple quoting mangles the JSON body). $STACKS_NODE_RPC_URL
# expands inside the container. result hex = 0x07(ok)+01(uint)+16B BE → int(hex[6:]).
chain=$(printf '%s\n' "curl -s -m 25 -X POST \"\$STACKS_NODE_RPC_URL/v2/contracts/call-read/$ADDR/$NAME/get-total-supply\" -H 'Content-Type: application/json' -d '{\"sender\":\"$ADDR\",\"arguments\":[]}'" \
  | ssh ryan@claude-mini "ssh app-server 'docker exec -i $API sh'" \
  | python3 -c "import sys,json;print(int(json.load(sys.stdin)['result'][6:],16))")

# decoded_net (the buggy plane) and raw_net (deduped firehose, authoritative)
read decoded_net raw_net <<<$(printf '%s\n' "
select
 (select coalesce(sum(amount::numeric),0) from decoded_events where event_type='ft_mint' and contract_id='$CID' and canonical)
-(select coalesce(sum(amount::numeric),0) from decoded_events where event_type='ft_burn' and contract_id='$CID' and canonical),
 (with d as (select distinct e.block_height,e.tx_id,e.event_index,e.type,(e.data->>'amount')::numeric amt from events e join blocks b on b.height=e.block_height where b.canonical and e.data->>'asset_identifier'='$ASSET' and e.type in ('ft_mint_event','ft_burn_event'))
  select coalesce(sum(amt) filter (where type='ft_mint_event'),0)-coalesce(sum(amt) filter (where type='ft_burn_event'),0) from d);
" | ssh ryan@claude-mini "ssh app-server 'docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAF\" \"'")

echo "sbtc chain=$chain decoded_net=$decoded_net raw_net=$raw_net"
# assert decoded_net==chain AND raw_net==chain; report Δ on any mismatch.
```
`decoded_net != chain` OR `raw_net != chain`: STOP, top-line finding, touch nothing.

## Phase 5 — known-bug regression probes (each one a past prod incident)

```bash
# 1. Accumulator guard holds (422, NOT a queued op — needs SL_API_KEY w/ owner rights):
curl -s -X POST -H "Authorization: Bearer $SL_API_KEY" -H 'Content-Type: application/json' \
  -d '{"fromBlock":100,"toBlock":200}' https://api.secondlayer.tools/api/subgraphs/sbtc-balances/backfill
# expect code BACKFILL_NON_REPLAYABLE_HANDLER. Skip if no key provided.

# 2. Increment/CHECK regression marker: any balance reindex halted at exactly
#    341445 (sbtc), 5269728 (usdcx), or 45563 (alex) = the ON CONFLICT footgun is back.
docker exec secondlayer-postgres-platform-1 psql -U secondlayer -d secondlayer_platform -tAc \
  "SELECT subgraph_name, left(error,80) FROM subgraph_operations WHERE status='failed' AND error LIKE '%balance_check%' AND finished_at > now() - interval '24 hours'"

# 3. Slack watcher quiet:
docker logs secondlayer-agent --since 2h 2>&1 | grep -iE 'Pattern:|alert' | tail -5

# 4. Reorg reconciliation — no stale old-fork rows survive in decoded_events.
#    A reorg hard-DELETEs decoded_events >= fork (handleDecodedEventsReorg, storage.ts);
#    before that fix a flag-only mark + later re-derive resurrected residue on SHIFTED
#    dense cursors (the 2026-05-26 reorg left 57 tx-absent orphans + a +152,062-sat sBTC
#    over-count; the 2026-05-07 reorg left 75 dup-on-shifted-cursor rows whose tx WAS
#    still canonical). Probe both shapes at once: per (block,tx) in a recorded reorg
#    window, decoded-row count must be ≤ raw streams-event count (excess = stale, covers
#    orphans AND dups; ≤ never false-positives on disabled decoders or decode-skips).
#    MUST be 0. Drives off chain_reorgs (2 rows) → index range scans over ~10 blocks; a
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
) r ON true;" | ssh ryan@claude-mini "ssh app-server 'docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tA'"
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
Conservation: ✓/✗ per token (internal sum==mints−burns; chain-truth decoded_net & raw_net == get-total-supply; exact deltas on ✗)
Regressions:  ✓/✗ (guard 422 / kill-block markers / watcher / reorg orphans=0)

Flags: <ambiguous, slow, or trending-wrong items + the exact command to dig deeper>
```

## Rules
- Read-only. Report and stop — remediation is a separate, human-approved step.
- Conservation or husk-canary failure is ALWAYS the top-line finding.
- Distinguish "broken" from "mid-backfill/mid-deploy" before flagging (op queue + gh run list).
- Holder counts shrinking vs the bands, or a previously-public seed going 404, are findings even if everything else is green.
