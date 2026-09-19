# Clarity state — what we are (and are not)

Internal. Positioning for the eval-hook write log. Product map (types, clocks, DX): [vm-events.md](./vm-events.md). Protocol-builder unlocks: [clarity-state-protocol-use-cases.md](./clarity-state-protocol-use-cases.md). Collect: [genesis-feeder.md](./runbook/genesis-feeder.md), plan 032.

Lineage: [Kourier](https://paragraph.com/@aulneau/project-kourier) (“historical data for any Clarity value”) · grant [291](https://github.com/stacksgov/grants-program/issues/291) · gist ([node-events.md](https://gist.github.com/aulneau/6df7e9dc8c63ad5ff7feb855825c68b9)) · node PR [3054](https://github.com/stacks-network/stacks-blockchain/pull/3054) (withdrawn) · fork image `ghcr.io/ryanwaits/stacks-core:441e595`.

---

## One line

Hiro indexes **logs and outer txs**. We index **what the VM committed** — data-vars, maps, inner `contract-call?` — genesis→tip. The node still runs MARF. The product is the complete **write log** in Postgres.

---

## MARF vs the write log

**MARF** is the node’s Merkle trie on disk (`/data/stacks`). Clarity `var-set` / `map-set` write that trie. RPC (`get-map-entry`, a read-only call) **reads the trie**. After genesis IBD the node has a full MARF again because it **executed** every tx. That is consensus / execution. We do not copy MARF into Postgres. We are not a second chain.

The **write log** is the same *committed storage facts*, as rows:

> height H, tx T, contract C, map M, key K → value V

That’s `vm_events` (`var_set`, `map_set`, `map_insert`, `map_delete`) plus `nested_contract_call`. Replay those rows in order and you know what any **stored** var/map was after any tx — Index / Streams `clock=vm` / subgraphs `vmEvents` — **without** asking the node.

Same information for committed stores. Different artifact: trie for execution and proofs, event log for products.

`vm_trace_max_bytes = 0` is how the log stays complete. A positive cap emits `truncated` and **drops later writes for that tx** — a hole you cannot fill from `"*"` later. We run cap 0. Truncation is an operator failure, not a product feature.

---

## What we persist

| Event | Why |
|---|---|
| `var_set` | data-var committed |
| `map_insert` / `map_set` / `map_delete` | map committed |
| `nested_contract_call` | inner `contract-call?` (callee, caller, `tx-sender`, args, result) |

Classic `"*"` plane is unchanged: outer `contract_call` txs, prints, FT/NFT/STX. Two clocks. Don’t mix them.

---

## What we intentionally do not persist

Not a debugger. Not every value the VM ever held.

| Skip | Why |
|---|---|
| `let` / locals | Never committed. Function-scoped. Dead after the expression. |
| Stack slots / VM internals | How the interpreter runs, not contract state. |
| `map-get` / `var-get` | **Reads.** If the write log is complete, the value is already implied by the last write to that key. Storing every get is a trace of *access*, not state — huge, and you don’t need it to answer “what is this map key.” |
| Every read-only **function return** | A function is code over storage (and maybe block-height, other contracts). We store the **inputs that live in storage**, not a row per `(get-balance alice)` call. |

We skip those because they are **not committed state**, not because we lack them yet.

---

## “Reproduce” (grant 291)

291: indexers should *“access (or correctly reproduce) any read-only values without needing to interact directly with a stacks node.”*

**Access** = the stored value itself. `balances[alice]` after height H is the last `map_set` on that key at or before H. No node. This we do (once genesis→tip is in `vm_events`).

**Reproduce** = a *computed* read-only function, e.g. something that sums a map or wraps several vars. 291 did **not** mean “save every function return as an event.” It meant: if you have storage history, you can **eval the function against reconstructed storage** and get the same answer the node would have given at that height.

Today:

- Stored vars/maps: query the log. Done.
- Computed read-only: `@secondlayer/stacks` `readContract` still hits a node. Optional “read from instance storage” (Clarity eval over the log) is **later**, not a new package. See [vm-events.md](./vm-events.md).

So: we can *reproduce* in the grant’s sense **once** we have complete writes + an evaluator. We do **not** need to have stored `let` / stack / `map-get` to get there. Writes are the sufficient journal.

---

## Grant / Kourier — claim vs don’t

If genesis IBD finishes with cap 0, this **is** 291 and the Kourier paragraph, as a product (fork node + our ingest), not a merged `stacks-network` PR:

| Wish | Us |
|---|---|
| State-change events | `var_set` / `map_*` |
| Inner `contract-call?` | `nested_contract_call` (caller vs `tx-sender`) |
| History, not tip-only | IBD so the log starts at genesis |
| Opt-in observer | `"storage"` / `"contract_calls"` (same note as 3054) |
| Historical **stored** values without RPC | query `vm_events` |

**Don’t say “any Clarity value.”** That’s every ephemeral. We persist **committed stores** + inner calls. Prints/FT/NFT stay on `"*"`.

**Don’t say we replaced the node.** MARF still lives there. The product is the log in Postgres, queryable like the rest of Secondlayer.

---

## What we package after the log is full

Not a new noun. Same five: Archive · Streams · Index · Subgraphs · Webhooks.

- Historical map/var: Index `event_type=map_set` / subgraph `type: "map_set"`
- Inner call graph / wrapper-phishing / CityCoins hole: `nested_contract_call` on the **callee**
- “What did this tx write?”: `var_set` + `map_*` for `tx_id`
- Computed read-only without RPC: later, eval over reconstructed storage

Until `min(vm_events.block_height)` is genesis-adjacent and the tip has caught up, we have the schema and the fork image, not the history.
