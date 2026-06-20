# Design spec: proper `pox-stacking` subgraph + `pox/cycles` migration

Status: v1 BUILT + local-tested 2026-06-20 (`subgraphs/pox-stacking.ts`), awaiting a free heavy-op
slot to deploy+reindex. v1 ships `actions` + `delegations` + `cycles` + `cycle_stackers`; the
`stackers` projection below is deferred (stack-increase needs cumulative accumulation). Author pass
2026-06-20.
Charter: `docs/internal/charter/index-vs-subgraphs.md` (this fulfills the "migrate `pox/cycles`
onto the `pox-stacking` subgraph" item).

## Why

The deployed `pox-stacking` subgraph is a stub, and the core endpoint it should replace is broken:

1. **Stub schema.** `subgraphs/pox-stacking.ts` keeps one table `calls(function_name, caller,
   result_ok)` — it throws away every stacking semantic (amount, pox-addr, lock period, reward
   cycle, delegate-to, signer key). You cannot answer "how much is stacked, by whom, in which
   cycle."
2. **Wrong start_block.** Deployed `start_block: 5_143_314`; pox-4 deployed at **147,290**. So it
   misses all stacking history below 5.14M (it has 16,749 of however-many calls).
3. **The core `/v1/index/pox/cycles` is broken.** It groups `pox4_calls` by `reward_cycle`, but the
   decoder only sets `reward_cycle` on `stack-aggregation-commit{,-indexed}` / `-increase` calls
   (see `packages/indexer/src/decode/decoders/pox-4.ts:243-322` — stack-stx rows leave
   `reward_cycle = null`). Those aggregation rows have null `stacker` and null `amount_ustx`, so the
   live endpoint returns `total_stacked_ustx: 0, unique_stackers: 0, action_count: 1` per cycle.
   Verified live 2026-06-20.

A proper subgraph decodes the args, projects stacker/delegation state, and derives a cycle for
**every** action — producing correct, non-zero cycle stats and letting us retire the broken endpoint.

## Decode mechanism

pox-4 emits **zero print events** — this is a `contract_call` source. The subgraph handler gets
`event.functionName`, `event.args` (positional decoded Clarity values, ABI order), `event.resultHex`,
and `ctx.block.burnBlockHeight`. Pass the pox-4 ABI on the source (`abi: POX4_ABI as const`) for a
typed named `event.input`, or destructure `event.args` positionally (mirrors the canonical decoder).

**Reward-cycle math (mainnet):** `cycle(burnHt) = (burnHt − 666_050) / 2_100`
(`packages/indexer/src/decode/decoders/pox-4.ts:22-23,664`). The call's cycle is
`cycle(ctx.block.burnBlockHeight)`; a new stack's target cycle is `cycle(start-burn-ht arg)`.

**Per-function arg layout** (port from `pox-4.ts:327-490`; `result_ok` = `resultHex` starts `0x07`):

| Function | args (positional) | Derives |
|---|---|---|
| `stack-stx` | amount-ustx, pox-addr, start-burn-ht, lock-period, signer-sig, signer-key, max-amount, auth-id | stacker=caller, amount_ustx, lock_period, pox_addr, start_cycle=cycle(start-burn-ht), end_cycle=start_cycle+lock-1, signer_key |
| `stack-extend` | extend-count, pox-addr, …signer | lock_period=extend-count, pox_addr, signer_key |
| `stack-increase` | increase-by, …signer | amount_ustx=increase-by, signer_key |
| `delegate-stx` | amount-ustx, delegate-to, until-burn-ht, pox-addr? | delegate_to, amount_ustx, pox_addr |
| `revoke-delegate-stx` | — | stacker=caller |
| `delegate-stack-stx` | stacker, amount-ustx, pox-addr, start-burn-ht, lock-period | stacker(arg), amount_ustx, lock_period, start_cycle, end_cycle |
| `delegate-stack-extend` | stacker, pox-addr, extend-count | stacker, lock_period |
| `delegate-stack-increase` | stacker, pox-addr, increase-by | stacker, amount_ustx |
| `stack-aggregation-commit[-indexed]` | pox-addr, reward-cycle, …signer | reward_cycle(arg), signer_key (+ signer index when indexed) |
| `stack-aggregation-increase` | pox-addr, reward-cycle, … | reward_cycle(arg) |
| `set-signer-key-authorization` | … | signer auth fields |

pox-addr is a `{version: (buff 1), hashbytes: (buff N)}` tuple → `formatBtcAddress(version,
hashbytes)` (`@secondlayer/stacks/sbtc`). Failed calls (`result_ok=false`) write base fields only.

## Schema (5 tables)

```
pox-stacking  (startBlock 147_290, source contract_call SP000…002Q6VF78.pox-4)

actions          one row per pox-4 call (the decoded event log; replaces the stub `calls`)
  function_name (text, idx)  caller (principal, idx)  stacker (principal, null, idx)
  delegate_to (principal, null, idx)  amount_ustx (uint, null)  lock_period (uint, null)
  pox_addr (text, null, idx)  start_cycle (uint, null)  end_cycle (uint, null)
  reward_cycle (uint, null, idx)  call_cycle (uint, idx)   signer_key (text, null)
  result_ok (boolean)  burn_block_height (uint)
  -- call_cycle = cycle(block.burnBlockHeight); reward_cycle = target cycle (see handler)

stackers         projection: current solo/delegated stacking state per address  [uniqueKeys (stacker)]
  stacker (principal)  amount_ustx (uint, null)  pox_addr (text, null)
  lock_period (uint, null)  start_cycle (uint, null)  end_cycle (uint, null)
  last_action (text)  last_cycle (uint, null)

delegations      projection: active delegation per delegator  [uniqueKeys (delegator)]
  delegator (principal)  delegate_to (principal, null)  amount_ustx (uint, null)
  active (boolean)  last_cycle (uint, null)

cycles           per reward cycle aggregate (replaces /v1/index/pox/cycles)  [uniqueKeys (reward_cycle)]
  reward_cycle (uint)  total_stacked_ustx (uint)  action_count (uint)
  -- maintained with ctx.increment (reorg-safe accumulators)

cycle_stackers   (reward_cycle, stacker) membership  [uniqueKeys (reward_cycle, stacker)]
  reward_cycle (uint)  stacker (principal)  is_delegator (boolean)
  -- upsert; unique_stackers/unique_delegators per cycle = COUNT over this table at read time
```

Amounts as `uint` (aggregatable via the `/aggregate` API). All projection/accumulator writes use
`ctx.upsert`/`ctx.update`/`ctx.increment` — journaled + reorg-safe (see charter).

## Handler design

Per call:
1. `if (!event.functionName) return;` skip unsupported (set of 12 above).
2. Decode args positionally (port `pox-4.ts` per-function helpers) → `{stacker, amount_ustx,
   lock_period, pox_addr, start_cycle, end_cycle, reward_cycle, signer_key}`. `caller = ctx.tx.sender`.
   `call_cycle = cycle(ctx.block.burnBlockHeight)`.
3. **actions:** `ctx.insert("actions", {...})` always (the raw log; failed calls too).
4. If `!result_ok` return (no state change).
5. **stackers projection** (`ctx.upsert` keyed `stacker`): for stack-stx/delegate-stack-stx set
   amount/pox/cycles; extend updates end_cycle; increase adds amount; revoke clears.
6. **delegations** (`ctx.upsert` keyed `delegator=caller`): delegate-stx sets delegate_to+amount+
   active=true; revoke-delegate-stx sets active=false.
7. **cycles + cycle_stackers** — attribute to a **target cycle** so stats are non-zero for real
   stacking (the core endpoint's bug):
   - new stacking (stack-stx, delegate-stack-stx): target = `start_cycle`; `ctx.increment("cycles",
     {reward_cycle: start_cycle}, {total_stacked_ustx: amount, action_count: 1})` +
     `ctx.upsert("cycle_stackers", {reward_cycle: start_cycle, stacker}, {is_delegator:false})`.
   - aggregation-commit/increase: target = `reward_cycle` arg; increment action_count.
   - delegate-stx: `cycle_stackers` row with `is_delegator:true` at `call_cycle`.
   - everything else: `increment` action_count at `call_cycle`.
   `is_current` is derived at read time (`reward_cycle == MAX(reward_cycle)`).

**Reorg safety:** `increment` commutes and is journaled; `upsert`/`update` pre-images are journaled;
inserts roll back by block. No hand-rolled totals.

## `pox/cycles` migration (charter)

The subgraph `cycles` + `cycle_stackers` reproduce — and fix — the endpoint:

| `/v1/index/pox/cycles` field | Subgraph source |
|---|---|
| `total_stacked_ustx` | `cycles.total_stacked_ustx` (now non-zero — sums real stack amounts, not aggregation rows) |
| `action_count` | `cycles.action_count` |
| `unique_stackers` | `COUNT(*) cycle_stackers WHERE reward_cycle=c AND NOT is_delegator` |
| `unique_delegators` | `COUNT(*) cycle_stackers WHERE reward_cycle=c AND is_delegator` |
| `function_breakdown` | `actions/aggregate?_count=*` filtered per function (or a small `cycle_functions` table if needed) |
| `start/end_block_height`, `is_current` | `actions` min/max block per cycle; max-cycle compare |

Then **hard-remove** `/v1/index/pox/cycles` + `/cycles/:reward_cycle` (route in
`packages/api/src/routes/index.ts`, reader `packages/api/src/index/pox-cycles.ts`). No frontend
consumer (verified — only the route, openapi, capabilities ref, ROADMAP reference it). Update
`secondlayer-capabilities.md` + openapi.

## Reindex plan

`startBlock: 147_284`→ use **147290** (pox-4 deploy). Deploy + reindex (mirror sbtc-flows):
`SL_API_URL=https://api.secondlayer.tools bunx sl subgraphs deploy subgraphs/pox-stacking.ts -y`.
Wait for a free heavy-op slot (currently sbtc-flows + bns-names hold the budget of 2). Mostly-empty
early blocks fly by; the dense region is the cost.

## Validation

The core endpoint is broken, so parity is "strictly better than core," not "equal." Validate against
external truth:
- `cycles.total_stacked_ustx` for recent cycles should be **non-zero** and track
  stacking-tracker.com / Hiro `/v2/pox` "stacked" per cycle (within rounding of attribution rule).
- `actions` total ≈ pox-4 call count (Hiro contract tx count) and ≥ the old stub's 16,749 (now with
  full history below 5.14M).
- Spot-check a known stacker: `stackers?stacker=SP…` shows their current lock.

## Open decisions

1. **Cycle attribution for `total_stacked_ustx`:** v1 attributes a new stack to its `start_cycle`
   (the commitment cycle). True "locked TVL per cycle" fans one stack across `start..end` cycles —
   a v2 refinement (one action → many `cycles` increments). Confirm v1 is acceptable.
2. **ABI vs positional args:** ship the pox-4 ABI on the source for typed `event.input`, or
   destructure `event.args` positionally (less code drift if the ABI churns)? Lean ABI for safety.
3. **`function_breakdown`:** derive via per-function aggregate reads, or materialize a
   `cycle_functions(reward_cycle, function_name, count)` increment table? Lean read-time.
4. **Endpoint removal timing:** remove `pox/cycles` in the same PR as the subgraph cutover, or
   deprecate first? (Charter says hard-remove; no consumers found.)

## Gotchas (from the sibling fixes)

- Deploy auto-versions (ignores file `version`); can't reindex while one runs (`cancel`, wait, redeploy).
- zsh `status` is read-only — never assign it in poll scripts (use `st`).
- pox-addr buffs arrive as `0x…` hex; decode with `formatBtcAddress`.
- Verify arg shape against a REAL pox-4 call before trusting positions (don't assume).
