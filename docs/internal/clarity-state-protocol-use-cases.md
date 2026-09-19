# Clarity state — protocol-builder unlocks

Internal. Companion to [clarity-state-positioning.md](./clarity-state-positioning.md) (what the log is) and [vm-events.md](./vm-events.md) (types, clocks, DX). Not a new product noun. After genesis IBD (`plans/032`), these are subgraphs / Index / Streams `clock=vm` / chain webhooks.

Lineage: [Kourier](https://paragraph.com/@aulneau/project-kourier) (2022-05-27) · grant [291](https://github.com/stacksgov/grants-program/issues/291) · gist [node-events.md](https://gist.github.com/aulneau/6df7e9dc8c63ad5ff7feb855825c68b9) · node PR [3054](https://github.com/stacks-network/stacks-blockchain/pull/3054) · Hiro API [#953](https://github.com/hirosystems/stacks-blockchain-api/issues/953) · [100proof `tx-sender` listing](https://100proof.org/a-questionable-design-choice.html). Incident demos (Charisma / ALEX LABUBU / 100proof): [clarity-state-incident-demos.md](./clarity-state-incident-demos.md).

---

## Split Kourier in two. We already shipped the first half.

Kourier’s body is an indexer architecture: don’t make every app run a node; split **raw capture** from **transformed views**; let people write custom views (The Graph, but Stacks); webhooks as “lambdas for Stacks.”

That is Secondlayer today:

| Kourier (2022) | Us |
|---|---|
| Microservice 1 — raw node events, resume, no node for consumers | **Archive** + **Streams** (signed dumps, cursor, SSE) |
| Microservice 2 — canonical blocks/txs/events | **Index** (decoder is a Streams consumer) |
| Tooling to write custom views | **Subgraphs** (`defineSubgraph`) |
| Discord / Cloudflare workers on contract filters | **Webhooks** |
| “Proofs alongside this data” | Tx **inclusion proofs** vs a stacks-node; Streams/Archive **ed25519**; not MARF |

The **last section** of Kourier is the gap Hiro never closed and 3054 never merged:

> If the Stacks node were to emit events for all Clarity state changes, this would open the door for completely new kinds of indexing services built on Stacks that other chains cannot replicate. You could imagine a service that would give historical data for any Clarity value you wanted.

Grant 291 / the gist / 3054 named the two node events: **storage writes** (`var-set`, `map-set`/`insert`/`delete`) and **inner `contract-call?`**. Hiro #953 is the CityCoins symptom: a pool calls `mine-many`; the explorer/API only show the outer tx; operators hardcoded the pool.

**032 + cap 0** is that last paragraph, as a product: the write log in Postgres, queryable on the same five nouns. Not a second chain. Not “any ephemeral Clarity value.” Committed stores + inner calls, genesis→tip.

Protocol builders are the customer. They already have prints/FT/NFT/outer txs. They do **not** have maps, vars, or the call graph.

---

## What protocol teams actually cannot do today

Three holes, all documented by other people before we existed:

1. **Silent state.** Listings, vault shares, allowlists, positions often `map-set` with a weak or missing `print`. Hiro and our `"*"` plane never see the write. Apps `readContract` at **tip** or lie about history. Kourier’s “historical Clarity value” is this.

2. **Composability is invisible.** User signs `pool.mine` / `router.swap` / `M.buy`. Inner call is `miamicoin.mine-many` / `token.transfer` / `nft.list-in-ustx`. Explorer and `contract_call` sources key the **signed payload**. Hiro #953: miamining.com had to hardcode the pool. stacking.club (291) could not see pool→PoX inner calls as first-class events.

3. **`tx-sender` is not `contract-caller`.** 100proof (2025): NFT `list-in-ustx` authenticates with `tx-sender`; a malicious commission `pay` lists the victim’s other NFTs. Post-conditions track **sends**, not map writes. The attack is a `nested_contract_call` to `list-in-ustx` where `sender !== caller`. Prints on `buy-in-ustx` do not show the inner lists. We do **not** sell a phishing SKU (charter). We **do** give the callee a webhook on that inner call.

EVM indexers get (2) from the call tree and (1) from storage traces / The Graph `store`. Stock Stacks does not emit either. That is the “other chains cannot replicate” line — inverted: **EVM already has this; Stacks apps have been flying blind.** The unlock is catching up to that, with Clarity’s typed maps as a better journal than raw EVM slots.

---

## Unlocks (protocol builders)

Ship as **their subgraph + optional chain webhook**, or `consume({ clock: "vm" })` / Index `event_type=map_set`. Boot-contract scoreboards stay Subgraphs, not new Index nouns.

### 1. Historical position / vault / listing — no tip RPC

**Who:** any protocol whose truth is a map (marketplace `market`, vault shares, PoX positions, sBTC amounts, BNS).

**Today:** UI calls `readContract` / `get-map-entry` for the current trie. Charts and “what did I have at height H” need a node with that trie, or a print they remembered to emit.

**After:** subgraph source `type: "map_set"` on that map. Rows are the write log. App query does not change (`sl.subgraphs.rows`). Tip RPC becomes a **spot-check**, not the product.

This is Kourier’s “historical data for any Clarity value” in the honest sense: **stored** keys, not every `let`.

### 2. Index without teaching the contract to print

**Who:** teams that will not add `print` to every `map-set` (gas, surface, already deployed).

**Today:** if it isn’t printed or an FT/NFT/STX event, it isn’t in Hiro or our classic Index.

**After:** deployed bytecode is enough. Genesis IBD sees every committed write. New collections (Gamma still minting `tx-sender` list contracts per 100proof) are indexable the day they deploy, without a v2 that prints.

### 3. See your protocol when users never call you

**Who:** tokens, NFT contracts, PoX, sBTC registry — callees of routers, pools, marketplaces.

**Today:** `contract_call` filter on *your* principal misses `router.swap` → inner `transfer`. CityCoins / stacking pools (291, #953).

**After:** webhook / subgraph `nested_contract_call` + `contractId = you`. `caller` is the router; `sender` is the signer. No hardcoded pool list. Tx internals: `event_type=nested_contract_call&tx_id=` for support (“what did this swap actually call”).

### 4. Failed inner attempt (not a write-then-undo)

**Who:** a **successful** outer tx that `(contract-call? …)`’d a callee, got `(err …)`, and **kept going** (handled the err; did not `try!` it out to abort the whole tx).

**Today:** that inner `(err …)` is invisible unless someone printed it. Explorer shows a successful outer tx. Inner writes never hit MARF (Clarity rolled them back with the inner response).

**After:** one `nested_contract_call` row, `raw_result` = `(err …)`. **No** `map_set` / `var_set` from that inner execution — the collector **drops** the inner batch on rollback (`storage.rs` `rollback_batch`). We do **not** log a write and then a compensating undo. The call is the evidence; absence of writes is the rollback.

If the **outer** tx itself returns `(err …)` / aborts, the caller’s batch is dropped too — no `vm_events` for that tx. `try!` of an inner err usually means the whole tx fails; this unlock is the **swallowed** inner err, not a failed transaction.

### 5. `sender !== caller` on *your* sensitive function

**Who:** NFT `list-in-ustx`, SIP-010 `transfer` if it uses `tx-sender`, admin, `set-approval`.

**Today:** 100proof attack: victim `buy-in-ustx` → malicious `pay` → inner `list-in-ustx` as the victim. Explorer shows a buy. Post-conditions allow it (no extra NFT *sent*).

**After:** subgraph on callee `list-in-ustx` / `transfer` where `sender !== caller`. Webhook to the protocol’s pager. Trigger is the **callee**. Still not a billed “phishing detector.”

Same pattern for protocol-admin keys 100proof warned: don’t use the governor address in a marketplace; if you do, inner-call alerts are the canary.

### 6. Scoreboards that match the contract, not the print log

**Who:** pox-5, sBTC, stacking.club-class aggregators (Kourier’s worked example).

**Today:** Index pox/sBTC is **prints + primitives** (charter). stacking.club had to bespoke-transform Hiro. A print that lies, or a `map-set` with no print, desyncs the dashboard.

**After:** subgraph sources on the **position maps**. Scoreboard is derived from writes. Index stays prints. Grant public goods (sBTC inclusion check) add a second source (deposit-map + inner registry calls) on the same path — still “built on Subgraphs and Webhooks.”

### 7. Growing address sets (Stacks “factory” ≠ EVM CREATE2)

Clarity **cannot** deploy a new contract from inside another contract. Deploy is a top-level tx. Secondlayer `factory: { from, field }` is not a clone helper — it is a **growing principal set**: an event on A reveals address B, then sources match B’s later events. Deliberately not tied to `contract_deploy` (pools, launchpad tokens, DAO allowlists, registry rows). See `packages/subgraphs/src/types.ts` `FactoryScope`.

**Who:** DEX registry + pools, launchpad that `map-set`s the new token principal, vault factory that records an already-deployed instance.

**Today:** discovery field has to be on a **print** or outer `contract_call`. A factory that only `map-set`s `pools[id] → principal` (no print) never grows the set.

**After:** `factory: { from: "registry", field: "…" }` on a `map_set` / `nested_contract_call` source. Inner `initialize` of a user-deployed instance shows up as `nested_contract_call` on that principal — still not on-chain CREATE.

### 8. App-index without Subgraphs

**Who:** data teams with their own DB.

**After:** `consume()` on `clock=vm` types `map_set` / `nested_contract_call`, `onReorg` already exists. Second checkpoint. Not a new package.

### 9. Faster product, same chain

Dashboards, bots, “what did this tx write?” (`var_set` + `map_*` for `tx_id`) hit Postgres. Consensus stays on the node. Spot-check a sample of map keys vs `get-map-entry`. Tx inclusion proofs still vs **any** stacks-node (ours, theirs, Hiro). **`vm_events` only vs a hooked node** — Hiro cannot referee maps/inner calls.

### 10. History of **protocol maps**, not wallet balances

Wallets already cache STX/FT/NFT (their indexer or Hiro). We do not win “stop `readContract` on every refresh.”

**Who:** the **protocol’s own UI** (vault, marketplace, stacking dashboard) that would otherwise run a private indexer or tip-read a map they never printed. Not Leather’s home screen.

**Today:** balances = token events (solved). Listing/share/position maps = tip RPC or a one-off indexer. “What was this at height H” is missing unless they printed every write.

**After:** same subgraph the protocol already runs. Last `map_set` is current; the log is history.

### 10b. Protocol-shaped wallet UI (Zapper-class, optional)

On EVM, portfolio UIs exist because call trees and storage are indexable. On Stacks, a wallet could show **balances** (token events) but not **positions** (vault share, listing map, pool map, inner `list-in-ustx`) unless it ran a custom indexer per protocol. That category barely exists.

**Who:** a wallet or portfolio that wants “your Stacks positions” in-product. Not Leather’s send/receive screen.

**Today:** STX/FT/NFT = their cache (solved). Protocol maps / inner listings = missing. NFT looks held but is listed; stacking share is a map, not an FT.

**After:** they consume **our subgraphs** (or `clock=vm`) instead of N protocol RPCs. We do **not** become Zapper. We are the feed that category was missing.

Launch stays protocol-first. This is a follow-on if a wallet sits on the log.

### 11. Webhooks on storage, not prints

**Not** “the print lied and the map didn’t move.” That is a broken contract. Prints are optional telemetry. The map **is** the state.

**Who:** keepers / liquidators / a dapp that needs a push when **this map key** changes, on a contract that **never printed** that write. Bytecode is frozen. They cannot add a `print` without a new deploy (and migrating every user).

**Today:** webhook on `print_event` / FT only. Silent `map-set` → poll `readContract` on a timer, or miss it. Most Clarity does not print every `map-set`. Listings, allowlists, share maps, admin vars.

**After:** trigger `map_set` + `contractId` + map name. Same signed POST. You index the contract **as it was deployed**, not as if they had built for Hiro.

**New contracts:** you do not `print` every `map-set` so an indexer can see it. The write log *is* the event. Prints become optional: a named topic or a payload that is **not** in storage (and anything that still has to show up on Hiro/explorers). That is a Clarity style choice, not a Secondlayer SKU.

Inner `list-in-ustx` (100proof) is the same pattern: the listing write often has no print on that path; the outer buy does. Prefer the callee/`map_set` trigger (use case 5), not a print/map consistency checker.

### 12. Parameter / admin history

**Who:** DAOs, vaults with `var-set` fees, caps, oracles.

**Today:** no log unless they printed. “When did the fee change?” is a node at-block scavenger hunt.

**After:** `var_set` filter on that var. Governance UIs and audits.

### 13. Invariant watch (two maps, one tx)

**Who:** vault share vs token supply, AMM reserve vs LP token, listing map vs NFT owner.

**Today:** you only see FT/NFT legs. The map can desync from the token event if the contract is sloppy.

**After:** subgraph handler sees `map_set` and `ft_transfer` on the same tx (classic then vm order). Flag rows where they disagree. Ops, not a product noun.

### 14. Support: “what did this hash actually do”

**Who:** protocol telegram, wallets, explorers that want a write tab.

**After:** Index `tx_id` + `clock=vm`. List inner calls + committed writes. Not a debugger (no `let` / stack). Enough to stop guessing from the explorer’s outer function name.

---

## What we do not unlock (don’t sell)

- A Clarity debugger / every `let` / stack / `map-get`.
- Reproducing arbitrary read-only **functions** without an evaluator (still `readContract` → node). Stored keys: yes.
- Backfill of inner calls from **today’s** R2 archive (`canonical/v1`, `"*"` payloads / classic `events` parquet). That dump never had `vm_events`. After 032 the rows live in **our** Postgres; offering `bootstrap`/`repair` of inner calls is a **new archive generation** (vm parquet / side object) — not automatic the day we hit tip. See [canonical-archive.md](./runbook/canonical-archive.md) and [vm-events.md](./vm-events.md) Archive DX.
- A public Explore of other people’s storage.
- A second consensus or light-client of MARF.

---

## Mapping to 032

Until `min(vm_events.block_height)` is genesis-adjacent and the tip has caught up, these subgraphs are empty for history. Live tip-only collection (image flip, no wipe) would unlock 3–5 from **that height forward** and leave 1–2 historically blind. Protocol builders who need “what was this listing at H” need 032.

Package: one `defineSubgraph` + optional webhook per protocol. No new Secondlayer noun.

---

## Launch (after 032 + soak, not before)

Do not announce a schema. Announce **one tx the eco already lost sleep over**, then the table.

**Killer demo (pick one, ship it as a deployment):**

1. **Hiro #953, closed icebox.** A CityCoins / pool `mine-many` inner call on a tx the explorer only shows as `pool.mine`. Side-by-side: explorer payload vs our `nested_contract_call` list. Named by the job (“inner calls on this tx”), public subgraph, “built on Subgraphs.”
2. **100proof listing.** Inner `list-in-ustx` where `sender !== caller` during a buy. Webhook the **callee**. Not a phishing product. One status page: “this NFT listed via a nested call.”
3. **Historical map.** One real listing/vault map, height slider, last `map_set` vs a live `get-map-entry` spot-check on the same key. Tradeoff out loud: storage history is our hooked execution; tx inclusion is any node.

Kourier (2022) already described the architecture we shipped. This launch is the **last paragraph**, four years later, with a genesis log. Voice: reader’s job, no competitor dunk in public copy (STRATEGY). Internally it is the gap they iced.

**Sequence:**

1. `min(vm_events)` genesis-adjacent, tip caught, sample keys match node RPC.
2. One design-partner protocol (not a catalog). Their subgraph in production.
3. One public-good deployment (above). Open verifier.
4. Then the post: evidence (heights, count, one tx id), not a feature list. Archive `vm_events` dataset (033) can trail; hosted query is enough to launch; bootstrap of inner calls is the self-host closer.

**Do not:** debugger, Explore of everyone’s storage, “second chain,” launch on empty `vm_events`, name Hiro in the first sentence.

---

## Why this is the company (acqui-shaped, not a pitch deck)

The scarce object is **genesis→tip Clarity writes + inner calls, in a queryable log, with a team that already runs Archive/Subgraphs/Webhooks.** Anyone can fork the node image. Nobody gets the history without the IBD (or our archive after 033). Hiro-shaped APIs stay on `"*"`. That is a structural hole, not a missing endpoint.

What a buyer is actually buying:

| Asset | Why it’s scarce |
|---|---|
| `vm_events` genesis log (+ later archive dataset) | Re-observe is weeks and a hooked binary. Cannot reconstruct from old dumps. |
| Hosted subgraphs/webhooks on that log | Distribution. Protocols don’t want to run IBD. |
| The five nouns already in market | Not a science project. Kourier’s architecture, shipped. |
| Team | Finished the node hook, ingest, clocks, archive machine. |

Who that is *for*: a Stacks data incumbent that iced nested calls; a foundation that wants 291 as a public good; a general indexer that wants Stacks without years of VM work. The story is **the missing data plane**, not a TUI and not `@secondlayer/stacks`.

Leverage: design partners before the post (they become the proof). One grant-shaped deployment (same rules as sBTC inclusion check). Fork image public, **history and hosted query** are the lock-in. Don’t PR `stacks-network` to make us redundant before the archive exists.

This is internal. Public copy still follows STRATEGY voice.
