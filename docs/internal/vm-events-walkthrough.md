# VM events — technical walkthrough

Internal. Not a public docs page. Companion to the [product map](./vm-events.md).
How the second clock is parsed, persisted, and read — and how to step through
it locally without a collecting node.

---

## What it does

Opt-in node traces (`storage` / `contract_calls`) land as a **second clock**:
inner `contract-call?` and committed map/var writes. Classic Streams 1.0
(`event_index`) is unchanged. You query them as five new Index/Streams types,
never mixed into prints or outer `contract_call`.

---

## How it flows

```
Stacks node /new_block  (or fixture → ingestNewBlock)
  → payload.vm_events present?
      no  → vmEvts = []  (`*` bodies omit the field)
      yes → parseVmEvent each row
            → node type → stored type (contract_call_event → nested_contract_call)
            → body under the node-type key, not the envelope
  → persistBlock
      → reorg at this height? archive txs/events/vm_events first
      → delete vm_events at height (height-only)
      → delete events, then txs at height
      → for each incoming tx: archive the old row if it lives at another height
      → insert txs (ON CONFLICT tx_id last-writer-wins)
      → insert events, insert vm_events (DO NOTHING)

Read
  Index  GET /v1/index/events?event_type=map_set
    → isVmIndexEventType → readVmIndexEvents (vm_events, not decoded_events)
    → tip clamped to source_block_height (vm lands with the block)
    → reorg overlap by height; resume includes the checkpoint even if empty

  Streams GET /v1/streams/events?clock=vm&types=map_set
    → readCanonicalVmEvents (vm_event_index as cursor second component)
    → inverted range (cursor past to_height) → next_cursor null
    → empty-but-valid range → toHeight:2147483647 sentinel

  SDK    events.list({ clock: "vm", ...on.mapSet().toStreamsParams() })
  Subgraphs  sources: { type: "map_set" | "nested_contract_call" | ... }
             → match vmEvents[], never events[]
```

---

## Two clocks

Classic rows live in `events` / `decoded_events`. Cursor is `height:event_index`.

VM rows live in `vm_events`. Cursor is `height:vm_event_index`. Same wire
envelope, different ordinal. A page never mixes them.

This is important — `nested_contract_call` is **not** Index `contract_call`.
Outer `contract_call` is the signed tx. Inner `contract-call?` is the VM trace.
Colliding those names is the explorer hole this closes.

Node JSON vs stored names, one map,
`packages/stacks/src/filters/event-types.ts`:

```ts
export const VM_NODE_TO_STORED_TYPE = {
	contract_call_event: "nested_contract_call",
	var_set_event: "var_set",
	map_set_event: "map_set",
	map_insert_event: "map_insert",
	map_delete_event: "map_delete",
} as const;
```

---

## Parse

`packages/indexer/src/parser.ts` `parseVmEvent`. Skip unknown types, skip
missing `vm_event_index`, skip a missing body-under-type-key. We do **not**
fall back to the envelope — storing `{txid, type, committed}` as `data` would
yield rows with no `contract_identifier`.

`ingest.ts` treats a missing field as empty, not an error:

```ts
const vmEvts = Array.isArray(payload.vm_events)
	? payload.vm_events.map((evt) => parseVmEvent(evt, payload.block_height))...
	: [];
```

`"*"` observers never send the field. Table stays empty until keys flip.

---

## Persist / re-mine

`packages/indexer/src/persist.ts`. Replace-per-height, then last-writer-wins on
`tx_id`.

VM deletes are **height-only**. A tx_id-scoped wipe would CASCADE-drop live
H+1 VM rows of a re-mined tx still listed at H (`0132_vm_events_fk_cascade`).

Before the conflict UPDATE moves T from H → H+1, we copy the old row (block
hash + execution fields) into `transactions_archive`. Height-scoped archive
never sees that row once ownership has moved — leftover VM at H would otherwise
archive with no matching tx.

---

## Index vs Streams

Index: one `event_type`, payload predicates (`function_name`, `caller`, `map`,
`var_name`, `tx_id`). Reads `vm_events.data` JSON. Tip is the **ingest** tip
(`source_block_height`), not the decoded tip — vm lands with the block, decoded
can lag.

Streams: `clock=vm` plus `types` + `contract_id`. No `sender` / `recipient` /
`asset_identifier` / labelled `filters` — those 400 rather than silently
widen. Cursor second component is `vm_event_index`.

SDK: `events.list` is the VM read. `consume` / `stream` stay classic (no
`clock`). Classic `on.ftTransfer().toStreamsParams()` has no `clock` and no VM
types, so existing consume spreads still type-check. VM members project
`{ types: ["map_set"], clock: "vm", contractId? }`.

---

## Subgraphs

`BlockData.events` classic, `BlockData.vmEvents` vm. A `map_set` source matches
only `vmEvents`. Runner orders a tx’s classic events first, then vm
(`clockRank`). Runtime id is `tx#vm:<index>`. The two ordinals are not
comparable.

---

## Reorgs

`GET /v1/streams/reorgs` `to` is a **classic** ordinal. VM consumers rewind by
`fork_point_height`, never by comparing that ordinal to `vm_event_index`.

A VM Index/Streams resume reports reorgs overlapping the checkpoint height even
when the replacement has no matching event, the next match is later, or the
source tip rewound below the cursor.

---

## How to test it

Local compose is **postgres only** (`127.0.0.1:5440`). No stacks-node, no
collecting observer. `docker/*/Config.toml` is still `events_keys = ["*"]`. You
will not see live `vm_events` from a node until that stanza becomes
`["*", "storage", "contract_calls"]`.

Do **not** POST a 990k fixture height into an indexer that is following
mainnet — integrity/tip-follower will treat 1..990000 as a hole. Use the test
DB + `bun test`, or an empty migrated DB.

### 1. Postgres + migrate

```bash
bun run db
bun run migrate
```

### 2. Parser (no DB)

Remap, skip unknown, skip missing body:

```bash
bun test packages/indexer/src/parser.test.ts
```

### 3. Ingest fixtures (needs DB)

This is the local write path. Fixtures in
`packages/indexer/test/fixtures/observer/`:

| file | what |
|---|---|
| `new_block.star.json` | `"*"` body, **no** `vm_events` field |
| `new_block.vm_events.json` | nested call + map_set on `vm_event_index` 0, 1 |
| `new_block.vm_events.empty.json` | `"vm_events": []` |
| `new_block.vm_events.all_types.json` | all five types; index 1 is a gap |

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5440/secondlayer \
  bun test packages/indexer/src/ingest-vm-events.test.ts
```

In-process: `ingestNewBlock(fixture)` → `parseVmEvent` → `persistBlock`.
Heights are 990201 so they don't collide with other suites. Expect: star writes
classic only; opt-in writes `nested_contract_call` + `map_set` and leaves
classic `smart_contract_event` in `events`.

### 4. Peek SQL

After a test (or skip cleanup by commenting `afterAll` once):

```sql
SELECT vm_event_index, type, data->>'contract_identifier'
FROM vm_events WHERE block_height = 990201 ORDER BY vm_event_index;

SELECT event_index, type FROM events WHERE block_height = 990201;
```

`events` must not contain `map_set` / `nested_contract_call`.

### 5. Persist edges

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5440/secondlayer \
  bun test packages/indexer/src/persist.test.ts
```

Step the re-mine test: T at H with a VM row → remine T at H+1 (tx moves, VM at
H+1 inserted) → replace H. After the move, `transactions_archive` already has T
at H with `orphaned_block_hash`. After replace-H, `vm_events_archive` has the
H VM row and H+1 is intact.

### 6. VM Streams reader

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5440/secondlayer \
  bun test packages/indexer/src/vm-streams-events.test.ts
```

Filtered-empty page → `H:2147483647`. `cursor=100:7&to_height=90` →
`next_cursor: null` (no rewind).

### 7. Index + Streams HTTP

API tests, mocked readers / DB:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5440/secondlayer \
  bun test packages/api/src/index/vm-events.test.ts \
           packages/api/src/streams/events.test.ts
```

Index: `event_type=map_set` routes to `readVmIndexEvents`. Resume with
`cursor=100:5` still reports a reorg at height 100 on empty / later-match /
tip-rewound.

Streams: `?clock=vm` uses `readCanonicalVmEvents`. Same reorg-span rule.

### 8. Manual HTTP on an empty DB (optional)

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5440/secondlayer \
  bun run --filter @secondlayer/indexer start &
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5440/secondlayer \
  DEV_MODE=true bun run --filter @secondlayer/api dev &
```

POST a fixture (rewrite height to 1 if the DB is empty so the tip is sane):

```bash
jq '.block_height=1 | .block_hash="0xvm-local"' \
  packages/indexer/test/fixtures/observer/new_block.vm_events.json \
| curl -sS -X POST http://127.0.0.1:3700/new_block \
    -H 'content-type: application/json' -d @-
```

Loopback reads are keyless:

```bash
# Index — vm type, payload predicates
curl -sS 'http://127.0.0.1:3800/v1/index/events?event_type=map_set&limit=10'
curl -sS 'http://127.0.0.1:3800/v1/index/events?event_type=nested_contract_call&function_name=set-value'

# Streams — second clock. Omit clock → classic 1.0, this fixture's print only.
curl -sS 'http://127.0.0.1:3800/v1/streams/events?clock=vm&types=map_set,nested_contract_call&limit=10'
```

Classic `?types=print` must not return the map_set row.

### 9. SDK type path

Compile-time: `packages/sdk/src/streams-filters.type-test.ts`.

```ts
sl.streams.events.list(on.mapSet({ contractId: "SP.store" }).toStreamsParams())
// → VmStreamsEvent[]

sl.streams.events.consume({
  ...on.ftTransfer({ assetIdentifier: USDC }).toStreamsParams(),
  onBatch,
})
// classic. no clock.

const params: StreamsEventsListParams = { clock: "vm" }
await sl.streams.events.list(params)
// StreamsWireEvent[]; map_set is legal
```

### 10. Subgraph match

`packages/subgraphs/src/runtime/vm-clock.test.ts` + `source-matcher.ts`. A
`map_set` source iterates `vmEventsByTx`, never `events[]`.

---

## What's deferred

- **Collecting node locally** — docker `events_keys` still `["*"]`. No live
  inner-call/storage until that stanza flips; old `"*"` archives cannot
  reconstruct them.
- **SDK `consume` / `stream` on `clock=vm`** — `list` is the VM SDK read.
  consume/stream do not forward `clock`.
- **Classic reorg `to` ordinal as a VM bound** — rewind by height. No `vm_to`
  on the reorg row.
- **Historical backfill of inner calls** — starts the day keys flip, unless we
  re-observe with a collecting node.
