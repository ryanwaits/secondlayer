---
name: pox5-activation
description: Verify the PoX-5 / epoch 4.0 hard-fork transition end to end — node followed the fork, decoder is producing pox5_events, the read API and SDK surfaces flipped, and the pox-4 era closed as designed. Use when the user runs "/pox5-activation", asks "did the fork work", "is pox5 decoding", "check the activation", or around Bitcoin block 960,230.
---

# PoX-5 activation check — the epoch 4.0 transition

Read-only. NEVER restart, redeploy, reindex, or mutate. Report a scorecard and stop.

SSH: `ssh app-server '<cmd>'` / `ssh node-server '<cmd>'` — direct, no jump host.
`app-server` has no `curl`/`jq` on the host; run them **inside** a container
(`docker exec … curl`). API: https://api.secondlayer.tools.

**Activation is Bitcoin block 960,230** (mainnet, epoch 4.0). Everything below has
two correct answers depending on which side of that height the chain is on — say
which side you are on *first*, or every result reads as a failure.

**Before flagging anything**: `gh run list --workflow deploy.yml --limit 1`. A deploy
`in_progress` produces a 1–2 min 502/500 window on the public API and explains
transient failures that are not fork-related.

## Phase 0 — which side of the fork are we on

```bash
ssh node-server 'curl -s localhost:20443/v2/info' | python3 -c "
import sys,json;d=json.load(sys.stdin)
b=d['burn_block_height']
print('server_version :', d['server_version'])
print('burn_height    :', b, '| activation 960230 |', 'POST-FORK' if b>=960230 else f'PRE-FORK ({960230-b} blocks, ~{(960230-b)*10/60:.1f}h)')
print('stacks_tip     :', d['stacks_tip_height'])"
```

`server_version` MUST report **4.0.1 or newer**. A node on an older binary does not
know epoch 4.0 exists and will stall at the fork — that is the single highest-severity
finding this skill can produce. Confirm the epoch is in the node's own schedule:

```bash
ssh node-server 'curl -s localhost:20443/v2/pox' | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('current_cycle:', d.get('current_cycle',{}).get('id'), '| next_cycle_in:', d.get('next_reward_cycle_in'))
[print(' ', e.get('epoch_id'), 'start_height', e.get('start_height')) for e in d.get('epochs',[])[-3:]]"
```

Expect an `Epoch40` row with `start_height 960230`. If it is absent, stop — the node
binary is wrong and nothing downstream matters.

## Phase 1 — the node followed the fork (POST-FORK only)

The real failure mode: the node stalls at the fork instead of crossing it.

```bash
ssh node-server 'curl -s localhost:20443/v2/info | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[\"stacks_tip_height\"],d[\"burn_block_height\"])"'
sleep 60
ssh node-server 'curl -s localhost:20443/v2/info | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[\"stacks_tip_height\"],d[\"burn_block_height\"])"'
```

`stacks_tip_height` MUST advance between the two samples. A frozen tip past 960,230
is a stalled node — top-line finding, page immediately.

Also check the node is not stuck reprocessing:
`ssh node-server 'docker logs --tail 40 secondlayer-stacks-node-1 2>&1 | grep -iE "error|panic|fatal|stall" | tail -10'`

## Phase 2 — the decoder is producing rows

```bash
ssh app-server 'docker exec secondlayer-decoder-1 curl -s localhost:3710/health' | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('overall:', d['status'])
for x in d['decoders']:
    if x['decoder'] in ('decode.pox5.v1','decode.pox4.v1'):
        print(f\"  {x['decoder']:18} lag={x.get('lag_seconds')}s cp={str(x.get('checkpoint')).split(':')[0]}\")"
```

- `decode.pox5.v1` present, `overall: healthy`, lag in **tens of seconds** = at tip.
- Large lag is acceptable ONLY during a known backfill/reindex — check the op queue
  before flagging (see `/prod-smoke` Phase 2).
- `decode.pox4.v1` will keep running and simply stop finding new work. Its lag staying
  low is correct; a *rising* pox-4 lag is unrelated to the fork.

Row counts:

```bash
echo "SELECT count(*) total, count(*) FILTER (WHERE canonical) canon, min(block_height) first_h, max(block_height) last_h FROM pox5_events;" \
  | ssh app-server 'docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAF" "'
```

PRE-FORK: `0 0` is correct and expected — not a finding.
POST-FORK: this must become non-zero within a few blocks of the first pox-5 call.
Zero rows well past activation, with the decoder healthy and at tip, means the decoder
is running but not matching — check the contract-id filter, then STOP and report.

Topic spread (POST-FORK):

```bash
echo "SELECT topic, count(*) FROM pox5_events GROUP BY 1 ORDER BY 2 DESC;" \
  | ssh app-server 'docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAF" "'
```

## Phase 3 — the read surfaces flipped

```bash
curl -s "https://api.secondlayer.tools/v1/index/pox5/events?limit=3" | head -c 400; echo
curl -s -o /dev/null -w "pox5/events %{http_code}\n" "https://api.secondlayer.tools/v1/index/pox5/events?limit=1"
curl -s -o /dev/null -w "pox/cycles/142 %{http_code}\n" "https://api.secondlayer.tools/v1/index/pox/cycles/142"
```

PRE-FORK: 200 with `{"events":[],…}` — correct.
POST-FORK: 200 with populated `events[]`, each carrying `cursor`, `topic`, and a
decoded `data` object. `amount_ustx`/`amount_sats` MUST be **strings** (bigint-safe);
a number there is a precision bug, not a cosmetic one.

## Phase 4 — the pox-4 era closed (EXPECTED, not a regression)

This is the part most likely to be misread as a break at 3am. `fix-pox4-era-honesty`
makes the pox-4 surfaces flip **automatically** the moment the first canonical
`pox5_events` row exists:

```bash
curl -s "https://api.secondlayer.tools/v1/index/pox/cycles?limit=3" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('notes:', d.get('notes'))
[print(' cycle', c['reward_cycle'], 'is_current=', c['is_current']) for c in d.get('cycles',[])[:3]]"
curl -s "https://api.secondlayer.tools/v1/index/stacking?limit=1" | python3 -c "
import sys,json;d=json.load(sys.stdin);print('stacking notes:', d.get('notes'), '| rows:', len(d.get('stacking',[])))"
```

POST-FORK expected: **no** cycle reports `is_current: true`, and both endpoints carry a
`notes` string pointing at `/v1/index/pox5/events`. `/v1/index/stacking` returning an
empty page for a recent window is **correct** — pox-4 stopped accumulating.

If `is_current: true` persists well after the first pox5 row lands, the era probe is
not flipping — that IS a finding (check `pox-era.ts`'s 30s memo for `false`, and that
`pox5_events` rows are `canonical = true`).

## Phase 5 — the invariant that has never been exercised

The `pox5_events` cursor is `<block_height>:<event_index>` and is the PRIMARY KEY. The
whole pagination design assumes that pair is unique per event. Fold-emitted topics
(`add-to-allowlist`, `bond-distribution`) emit **many prints per transaction** — this
is the first time real data tests that assumption. A collision would show up as
silently *missing* rows (upserted over), not as an error.

```bash
echo "SELECT p.tx_id, count(*) rows, count(DISTINCT p.event_index) distinct_idx
FROM pox5_events p WHERE p.topic IN ('add-to-allowlist','bond-distribution')
GROUP BY 1 HAVING count(*) <> count(DISTINCT p.event_index) LIMIT 5;" \
  | ssh app-server 'docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAF" "'
```

Zero rows returned = invariant holds. Any row = a real cursor collision: report it as
the top-line finding and do NOT attempt a fix — it is a founder-level design decision
(see `plans/feat-pox5-decoder.md` STOP conditions).

Cross-check that nothing was dropped between raw and decoded:

```bash
echo "SELECT (SELECT count(*) FROM events e WHERE e.contract_identifier='SP000000000000000000002Q6VF78.pox-5' AND e.type='print_event') raw_prints,
(SELECT count(*) FROM pox5_events) decoded_rows;" \
  | ssh app-server 'docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tAF" "'
```

`decoded_rows` should track `raw_prints`. A persistent shortfall means events are being
skipped — the decoder logs unknown topics as `pox5_decoder.unknown_topic`, so check
`ssh app-server 'docker logs --tail 200 secondlayer-decoder-1 2>&1 | grep pox5'`.

## Report format

```
## PoX-5 Activation — <date>

Side of fork: PRE (N blocks, ~Xh) | POST (activated at burn 960230)

Node:      ✓/✗ (version 4.0.1+ / Epoch40 in schedule / tip advancing)
Decoder:   ✓/✗ (decode.pox5.v1 lag Ns / N rows / topic spread)
Read API:  ✓/✗ (pox5/events 200 + populated / amounts are strings)
Era flip:  ✓/✗ (no cycle is_current / notes present on cycles + stacking)
Invariant: ✓/✗ (cursor uniqueness on fold topics / decoded tracks raw)

Flags: <anything ambiguous, plus the exact command to dig deeper>
```

## Rules

- **Read-only.** Report and stop. Remediation is a separate, human-approved step.
- **State the side of the fork first.** Pre-fork zeros are correct, not failures.
- A stalled `stacks_tip_height` past 960,230 outranks every other finding.
- Phase 4's flip is EXPECTED. Never report the pox-4 surfaces going quiet as a
  regression — report it as confirmation the era-honesty change worked.
- Distinguish "not yet" from "broken": the first pox-5 event needs someone to actually
  call the contract. An empty `pox5_events` an hour after activation with a healthy
  decoder may just mean nobody has staked yet — check `raw_prints` before flagging.
- **This skill is scaffolding with a shelf life.** Once the fork is verified and stable,
  graduate the durable checks — Phase 5's cursor-uniqueness query and the
  decoded-vs-raw cross-check — into `/prod-smoke` Phase 5 as permanent regression
  probes, and retire this file. That is how `/prod-smoke` grew its existing probes.
