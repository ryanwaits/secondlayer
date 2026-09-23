# After the node: Secondlayer ingest and DX

Internal. Not a public docs page. Not a new product noun.

The node PR ([stacks-network/stacks-core#7630](https://github.com/stacks-network/stacks-core/pull/7630)) emits `vm_events`. Secondlayer is the consumer: persist, cursor, decode, query. This is what that looks like on the five nouns that already exist (Archive · Streams · Index · Subgraphs · Webhooks).

Prints are optional and unstructured. Inner `contract-call?` is **missing from the chain data plane**, not a decoder bug. Hiro, 2022: [API #953](https://github.com/hirosystems/stacks-blockchain-api/issues/953) — MiamiCoin `mine-many` via a pool is invisible; “needs core node changes.” That is this PR. Grant [stacksgov/grants-program#291](https://github.com/stacksgov/grants-program/issues/291) asked for state-change events + nested calls so indexers can reproduce read-only values without a node RPC.

Secondlayer today already does instance queries on what `"*"` emits: outer `contract_call` txs, `print_event`, FT/NFT/STX. It does not see the call graph or committed storage.

Cursor 1.0 stays. `vm_events` is a **new Index type / Streams type**, never mixed into `(block_height, event_index)`.

Assume the current node design lands. This file is the product map. First slice is persist + types, not a new product. Local parse/persist/read step-through: [vm-events-walkthrough.md](./vm-events-walkthrough.md). What this is vs MARF / “any Clarity value”: [clarity-state-positioning.md](./clarity-state-positioning.md).

---

## One line

Prints + outer txs made instance queries for **logs**. This makes instance queries for **what the VM actually did** — especially the inner call the explorer never showed (CityCoins indexing hole and wrapper-phishing hole). No new Secondlayer product. Five new event types, a second ordinal, operator `events_keys` off `"*"` alone.

---

## Naming (do not invent a third dialect)

Node JSON `type` (opt-in `/new_block.vm_events`):

| Node `type` | Secondlayer `event_type` / subgraph `sources[].type` / webhook `trigger.type` |
|---|---|
| *(outer tx, already exists)* | `contract_call` — **keep**. Signed payload. Not inner. |
| `contract_call_event` | `nested_contract_call` |
| `var_set_event` | `var_set` |
| `map_set_event` | `map_set` |
| `map_insert_event` | `map_insert` |
| `map_delete_event` | `map_delete` |

Do not fold inner calls into Index `contract_call`. That feed is the outer tx. Colliding the names is how the explorer bug stays.

---

## Operator (self-host)

Today every node compose file is `"*"` only:

`docker/oss/Config.toml`, `docker/node-server/Config.toml`, `docker/stacks-node/Config.toml`, `packages/cli/src/lib/observer-stanza.ts`:

```toml
events_keys = ["*"]
```

After:

```toml
[[events_observer]]
endpoint = "indexer:3700"
events_keys = ["*", "storage", "contract_calls"]
```

`"*"` stays for Hiro-stable classic payloads. `"storage"` / `"contract_calls"` add `vm_events` for this observer only. `"contract_call"` (singular) is invalid and panics on node start.

Collection is off unless someone opted in. Old Archive payloads have no `vm_events`. Historical inner-call/security starts the day the keys flipped, unless we re-observe with a collecting node. We cannot reconstruct inner calls from old `"*"` bodies. Say that out loud.

---

## Nested calls — the actual unlock

Explorer and Index both key off the **signed payload**. User signs `M.buy`. `M` then `(contract-call? .marketplace list-in-ustx …)` and `(contract-call? .token transfer …)`. Hiro, explorer, our `contract_call` source, our webhook `type: "contract_call"` all show **`M.buy`**. Inner calls do not exist.

Phishing shape (`tx-sender`): victim signs a wrapper; wrapper is `tx-sender`; NFT `list-in-ustx` thinks the victim listed. Explorer: “you called `M.buy`.” Not “`M` listed your bag at 1 µSTX.”

Same gap, not a hack: CityCoins / stacking pools / routers. Outer tx is `pool.mine`. Inner is `miamicoin.mine-many`. Operators hardcoded the pool.

### What the event is

```
nested_contract_call          # node: contract_call_event
  contract_identifier         # callee — what got called
  sender                      # tx-sender (the signer)
  caller                      # the contract that issued contract-call?
  function_name
  function_args
  raw_result
  txid
  ordinal
```

Lives on the **caller’s** batch. Inner `(err …)`: writes gone, call event kept if the caller committed. That’s “attempted drain, aborted.”

You never know the wrapper in advance. Watch **your** contract as the callee. Discover `caller` from the event. Smell is `sender !== caller`.

Today you can sometimes *guess* via an `ft_transfer` joined to an outer tx that wasn’t sent to your token. That’s a join, not a call: no `caller`, no inner function, no args, no `raw_result`. Nested `(err …)` is invisible. `list-in-ustx` / pox-5 / vaults often emit no FT/NFT.

```ts
// TODAY — outer tx only. Never fires for SP.marketplace.list-in-ustx
sources: {
  buy: { type: "contract_call", contractId: "SP.malicious", functionName: "buy" },
}

// AFTER — watch the callee
sources: {
  innerList: {
    type: "nested_contract_call",
    contractId: "SP.marketplace",
    functionName: "list-in-ustx",
  },
}
```

---

## Storage writes — prints lie, maps don’t

sBTC-flows today is prints (`bench/subgraphs/sbtc-flows-bench.ts`):

```ts
sources: {
  registry: {
    type: "print_event",
    contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
    prints: { "*": { value: "jsonb" } },
  },
}
```

Works while the registry prints. A `map-set` with no print is a hole. A print with no write is a ghost. Handler-time `readContract` is tip-only and breaks history.

Instance queries for printed rows already exist. This does not invent Postgres. It lets subgraphs source **storage**, not only **logs**.

PoX-5 Index is already “the print log, not a position scoreboard.” Scoreboard = `map_set` on the position maps → a subgraph. Charter holds: not a new `/v1/index/pox5/positions`.

---

## Map onto the five nouns

Summary:

| Noun | Today | After | Don’t |
|---|---|---|---|
| **Streams** | All-types firehose, one cursor (`stream_event_index` over classic events) | Five new types on a **second** ordinal (`ordinal`). Filter-invariant cursor stays, on that ordinal | Interleave into classic `event_index` |
| **Index** | One `event_type` per seek | Same rule, new types. `GET /v1/index/events?event_type=nested_contract_call&contract_id=` | Fold into `contract_call` |
| **Subgraphs** | `VALID_FILTER_TYPES` = stx/ft/nft/print/`contract_call`/deploy | Add the five; `trait` + `factory` compose like print | RPC hydrate in handlers |
| **Webhooks** | `chain.contract_call.apply` = outer tx | `chain.nested_contract_call.apply`, `chain.map_set.apply`, … | A “security product” SKU |
| **Archive** | Signed `/new_block` history from `"*"` | Bootstrap `vm_events` only from nodes that had the keys | Pretend genesis backfill exists without re-observe |

`@secondlayer/stacks`: `readContract` stays for computed fns. Optional “read from instance storage” later. Not a new package.

MCP: tools already query Index/subgraphs. New types show up. No new MCP product.

Deployments (sBTC inclusion check, protocol public goods): second source on the same subgraph. Still named by job, still Subgraphs + Webhooks.

### Streams — end-user DX

**Today.** One checkpoint over the full classic event set. sBTC token decoder consumes `ft_transfer` + `ft_mint` + `ft_burn` under that clock. Labels can change without invalidating the cursor.

```ts
await sl.streams.events.consume({
  types: ["ft_transfer", "ft_mint", "ft_burn"],
  cursor: saved,
  onEvent: (e) => { /* supply conservation */ },
  onCheckpoint: (c) => save(c),
});
```

**After.** Do not put `map_set` on that cursor. New consume (or a `clock: "vm"`) over `ordinal`. Two checkpoints if you want both logs and storage. That is the cost of not renumbering Hiro/Secondlayer 1.0.

```ts
await sl.streams.events.consume({
  types: ["map_set", "map_delete", "nested_contract_call"],
  clock: "vm", // ordinal, not stream_event_index
  cursor: savedVm,
  onEvent: (e) => {
    if (e.event_type === "nested_contract_call") {
      // callee, caller, sender, function_name, raw_result
    }
  },
});
```

CLI, same split:

```
secondlayer streams events --types print,ft_transfer
secondlayer streams events --types map_set,nested_contract_call --clock vm
```

**Don’t.** Merge the two ordinals so one `consume()` sees prints and map-sets in one `event_index`. That is the silent break this node PR exists to avoid.

### Index — end-user DX

**Today.** Single `event_type`. Seek on `(event_type, block_height, event_index)`. `contract_call` is the outer tx feed (`/v1/index/contract-calls` / `event_type=contract_call`).

```ts
const { events } = await sl.index.events({
  eventType: "contract_call",
  contractId: "SP.my-token",
  functionName: "transfer",
  limit: 25,
});
// only txs whose payload is SP.my-token.transfer
```

```
curl "http://127.0.0.1:3800/v1/index/events?event_type=contract_call&contract_id=SP.my-token"
```

**After.** New types, same one-type-per-seek rule (charter: Index vs Streams). Filter the callee, not a wrapper you don’t know.

```ts
const { events } = await sl.index.events({
  eventType: "nested_contract_call",
  contractId: "SP.my-token",       // callee
  functionName: "transfer",
  txId: "0xabc",                   // optional: call tree for one tx
  limit: 25,
});
// dex.swap signed → inner transfer to this token shows up

const { events: writes } = await sl.index.events({
  eventType: "map_set",
  contractId: "SM3….sbtc-registry",
  map: "amounts",
});
```

Tx internals page (dogfood Index, do not build an explorer product):

```
GET /v1/index/events?event_type=nested_contract_call&tx_id=0xabc
GET /v1/index/events?event_type=map_set&tx_id=0xabc
```

Hiro stays blind unless they opt into `"contract_calls"` / `"storage"`.

**Don’t.** `event_type=contract_call` meaning both outer and inner. Don’t multi-type Index (see `docs/internal/charter/index-vs-streams.md`).

### Subgraphs — end-user DX

**Today.** Scaffold → deploy → query. Sources are the `"*"` set.

```ts
export default defineSubgraph({
  name: "sbtc-flows",
  sources: {
    registry: {
      type: "print_event",
      contractId: "SM3….sbtc-registry",
      prints: { "*": { value: "jsonb" } },
    },
  },
  schema: { flows: { columns: { topic: { type: "text", indexed: true } } } },
  handlers: {
    registry: (event, ctx) => ctx.insert("flows", { topic: event.topic }),
  },
});
```

```
secondlayer subgraphs deploy subgraphs/sbtc-flows.ts --start-block 328312
secondlayer subgraphs query sbtc-flows flows --sort _block_height --order desc
```

App:

```ts
const { rows } = await sl.subgraphs.rows("sbtc-flows", "flows", { limit: 25 });
```

**After.** App query unchanged. Source changes. `trait` / `factory` compose like print.

```ts
export default defineSubgraph({
  name: "sbtc-flows",
  sources: {
    amounts: {
      type: "map_set",
      contractId: "SM3….sbtc-registry",
      map: "amounts",
    },
    amountsDel: {
      type: "map_delete",
      contractId: "SM3….sbtc-registry",
      map: "amounts",
    },
    intoRegistry: {
      type: "nested_contract_call",
      contractId: "SM3….sbtc-registry",
      // any inner call into the registry, including from routers
    },
  },
  schema: {
    balances: {
      columns: {
        key: { type: "text", indexed: true },
        value: { type: "jsonb" },
        height: { type: "uint" },
      },
      uniqueKeys: [["key"]],
    },
    impersonated: {
      columns: {
        signer: { type: "principal", indexed: true },
        wrapper: { type: "principal", indexed: true },
        fn: { type: "text" },
        result: { type: "text" },
        tx_id: { type: "text" },
      },
    },
  },
  handlers: {
    amounts: (e, ctx) =>
      ctx.upsert("balances", { key: e.raw_key }, {
        value: e.raw_value,
        height: BigInt(ctx.block.height),
      }),
    amountsDel: (e, ctx) =>
      ctx.patch("balances", { key: e.raw_key }, { value: null }),
    intoRegistry: (e, ctx) => {
      if (e.sender !== e.caller) {
        ctx.insert("impersonated", {
          signer: e.sender,
          wrapper: e.caller,
          fn: e.function_name,
          result: e.raw_result,
          tx_id: ctx.tx.txId,
        });
      }
    },
  },
});
```

Filters vocabulary (same `on()`, new projections):

```ts
on.nestedCall({ contractId: "SP.pox-5", functionName: "stack-stx" })
on.mapSet({ contractId: "SP.pox-5", map: "reward-cycle-total-stacked" })
```

**Don’t.** `await stacks.readContract(...)` inside a handler to “fill in the map.” That’s tip-only, rate-limited, not historical, and the whole point of this input.

### Webhooks — end-user DX

**Today.** Chain trigger = outer tx or classic event. Forward-looking, no backfill.

```
secondlayer subscriptions create amm-swaps \
  --url https://my-app.com/webhook \
  --trigger '{"type":"contract_call","contractId":"SP....amm","functionName":"swap-*"}'
```

Fires when the **signed** payload is that AMM. A router that `contract-call?`s the AMM does not fire.

**After.** Watch the callee.

```
secondlayer subscriptions create sip010-inners \
  --url https://app/hooks/inners \
  --trigger '{
    "type": "nested_contract_call",
    "contractId": "SP.my-token",
    "functionName": "transfer"
  }'
```

Wallet signed `SomeDex.swap`. Hook fires because the dex `contract-call?`’d `transfer`. Envelope is the existing `chain.<trigger>.apply` shape:

```json
{
  "action": "apply",
  "trigger": "nested_contract_call",
  "tx_id": "0x…",
  "block_height": 180012,
  "event": {
    "type": "nested_contract_call",
    "contract_identifier": "SP.my-token",
    "sender": "SP…victim",
    "caller": "SP…dex-or-wrapper",
    "function_name": "transfer",
    "function_args": ["…"],
    "raw_result": "0x…"
  }
}
```

`sender !== caller` is the smell. You discover the wrapper from `caller`. You do **not** put `caller: "SP.malicious-wrapper"` in the trigger.

Storage:

```
secondlayer subscriptions create listing-writes \
  --url https://app/hooks/listings \
  --trigger '{"type":"map_set","contractId":"SP.marketplace","map":"listings"}'
```

Reorg: existing `chain.reorg.rollback` / `orphaned` list. `ordinal` rows need the same apply/rollback pairing. Don’t invent a second webhook product for that.

Delivery identity is per clock. A vm apply row keys `chain:<webhook>:<tx>:vm:<ordinal>:<block_hash>` with `row_pk.clock = "vm"`; classic keys are unchanged. A print at `event_index 0` and a `map_set` at `ordinal 0` in one tx are two deliveries.

### Subgraph runtime — two clocks, never merged

`BlockData` carries `events` (classic) and `vmEvents` (vm clock) separately on every source: the Postgres tap reads `vm_events`, the Streams+Index source routes vm walks into `vmEvents`, the observer-HTTP source maps `/new_block.vm_events`. A vm source matches only `vmEvents`; a `contract_call` / `contract_deploy` source fans out to classic types only and never sees vm rows. Runtime ids are `tx#vm:<index>`; the runner orders a tx’s classic events first, then its vm events (the ordinals are not comparable).

### Reorg envelope — rewind VM consumers by height

`GET /v1/streams/reorgs` reports a `to` ordinal computed from classic `events` (`reorg.ts`). It is not a VM upper bound. VM consumers roll back rows at or above `fork_point_height` and resume from the foot of that height. Never compare the envelope's classic ordinal with `ordinal`.

VM Index and Streams pages include reorgs overlapping the resume height, even when the replacement has no matching events, the next match is at a later height, or the source tip has rewound below the checkpoint. For independent `/v1/streams/reorgs` polling, use its timestamp/`next_since` tokens, not a VM event cursor. The endpoint's event-cursor form belongs to the classic clock.

**Don’t.** A billed “phishing detector” SKU. It’s a subgraph + a chain webhook.

### Archive — end-user DX

**Today.** Signed canonical `/new_block` history. Bootstrap/repair from R2. Metered. Payloads are `"*"`-shaped: no `vm_events`.

**After 032 (tip, `vm_events` in our Postgres).** Same archive machine as classic chain data — not a side door. Today `CanonicalDataset` is `"blocks" | "transactions" | "events"` (`export-snapshot.ts` / `restore-snapshot.ts`); bootstrap/repair/verify and metering already run on those partitions. Add `"vm_events"` as a fourth dataset (parquet by `block_height`, FK after `transactions`), same signed snapshot, same `secondlayer bootstrap` / `verify` / `repair`, same prepaid credits. v1 snapshots that lack that dataset stay classic-only. A snapshot **with** `vm_events` only exists after a collecting node filled the table (032), then a publish. Until that gen is promoted, self-host `bootstrap` still cannot invent inner calls.

```
# self-host after keys flip: live ingest has vm_events
# bootstrap from an old snapshot: classic events only; vm tables stay empty until live tip
```

**Don’t.** Claim we can backfill inner calls from genesis using the current R2 archive. We can’t. Re-observe or accept a floor height.

---

## Use cases

**A. Tx internals.** `event_type=nested_contract_call&tx_id=`. Wallets, support, “what did this swap actually call.” Replaces hardcoding the pool.

**B. Who touched my contract?** Webhook on `nested_contract_call` + `contractId = my protocol`. Today you only see outer txs *to* you. Routers never show up as your `contract_call`.

**C. tx-sender phishing detector.** Subgraph: inner call, `sender !== caller`, callee is SIP-009/010 `transfer` / `list-in-ustx`. Alert webhook. [100proof.org NFT listing](https://100proof.org/a-questionable-design-choice.html) is this query. Trigger is the **callee**.

**D. Failed inner attempt.** Outer tx **committed**. Inner `contract-call?` returned `(err …)` and the caller handled it. Log: `nested_contract_call.raw_result` is `(err …)`; **no** inner `map_set` (that batch was dropped, not written-then-undone). If the outer tx aborted, there is no row. `try!` of inner err is usually the abort path.

**E. Protocol scoreboards.** pox-5 / sBTC / BNS maps → subgraph tables. Index stays prints + primitives. Charter: scoreboard is Subgraphs.

**F. Silent-state protocols.** Marketplace listings, vault shares, allowlists that barely print. Today: `readContract` per screen or a lie. After: `map_set` is the row. App `sl.subgraphs.rows` does not change.

**G. Factory clones.** Existing `factory: { from, field }` on print/`contract_call`. Same on `map_set` / nested call.

**H. Deployments.** sBTC inclusion check and other grant public goods: second source (deposit-map writes + inner calls into the registry), same path, still “built on Subgraphs and Webhooks.”

**I. App-index `consume()`.** Data teams who skip Subgraphs: second `consume()` on `event_type=map_set`, own tables, `onReorg` already exists.

**J. What did this tx do to storage?** `var_set` + `map_*` for `tx_id`. Mainnet, not only Clarinet.

**K. Don’t build.** A Clarity debugger product. A public Explore of other people’s storage (no catalog unless a grant). `var-get` events (still not an event). Changing `"*"` payloads.

---

## What this is not

- Not “instance queries are new.” Those exist for prints/FT/NFT/outer calls.
- Not reads (`var-get` / `map-get`). The grant’s “reproduce read-only values” is the **consumer** of the write log, via a subgraph row (or local eval of a computed fn).
- Not Hiro-on-`"*"` growing a `vm_events` field.
- Not a new Secondlayer product. Five types, a second ordinal, operator keys off `"*"` alone.

---

## Pointers

- This repo: `STRATEGY.md` (five nouns), `docs/internal/charter/index-vs-streams.md`, `docs/internal/charter/index-vs-subgraphs.md`, `packages/subgraphs/src/validate.ts` (`VALID_FILTER_TYPES`)
- Collecting-fork config lives only in `docker/feeder/Config.toml`: `events_keys = ["*", "storage", "contract_calls"]` + `vm_trace_max_bytes = 0`. Stock `stacks-core` panics on those keys, so every operator-facing config (`docker/oss/Config.toml`, `docker/stacks-node/Config.toml`, `oss-compose.ts`, `observer-stanza.ts` in both modes) stays `["*"]` until the fork image ships publicly. Prod `docker/node-server/Config.toml` stays `["*"]` too. Ingest assigns the second clock from `vm_events` array order; the node does not send `ordinal`.
- Full history: empty-disk genesis feeder, never a Hiro snapshot. Runbook: [runbook/genesis-feeder.md](./runbook/genesis-feeder.md). Leave `vm_trace_max_bytes = 0`. A `truncated` marker is dropped writes, not a cursor.
