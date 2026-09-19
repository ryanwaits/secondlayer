# Clarity state — incident demos (IN vs OUT)

Internal. Not a public docs page. Not a phishing SKU. Companion to [vm-events.md](./vm-events.md) and [clarity-state-protocol-use-cases.md](./clarity-state-protocol-use-cases.md). Research synthesis: `~/reports/stacks-nested-call-hacks.md`.

Warning ≠ prevention. `vm_events` persist only on **committed** outer txs (caller’s batch). Inner `(err …)` that the caller swallows keeps the `nested_contract_call` and **drops** that inner `map_set`/`var_set`. Outer abort → **no rows**. `as-contract` rewrites `tx-sender` to the current contract: **`sender === caller` after as-contract**. **`sender !== caller` is the phishing/proxy warning, not the vault drain.** Index `clock=vm` for a `tx_id`; subgraph / chain webhook on **callee + function**. Cannot reconstruct these trees from today’s `"*"` archive.

---

## OUT — do not demo as nested-call

| Incident | Why it is out |
| --- | --- |
| **Zest** (2024-04-11, 322k STX) | Duplicate `{asset, lp-token, oracle}` in a signed `borrow` list. Math. Example txs `0x8c76170d1740cc70ff65f50262d12b9a28ae23702274825225d31e1639e95906`, `0x03233c5112391647518c0a0ec69d7cb3cbffe9c917a18727007c43f0291b9dd3`. |
| **XLink / ALEX 2024** (~$4.3M) | Compromised key; BSC proxy upgrade. Not Clarity inner call. |
| **Velar PerpDEX** (Stacks ~Jan 2026) | Oracle timestamp / isolation. Velar: not a smart-contract hack. No official Stacks loss figure — do not invent. |
| Arkadiko Swap 2021 | Trait **argument** in the signed payload (`create-pair` LP not bound to pair). Weak. Tx `0x4d78fe328be831db1b68e50c4eab7fc57c328af5f441d40238436893d1b8ee28`. |
| Stacks GitHub 2025-03-28 | Supply chain; funds safe. |
| Arkadiko “zero-fragment” gist | Unverified / PoC only. |
| Gamma Strategies 2024 | EVM/Arbitrum, not Stacks. |

---

## IN — inner-call / committed-write demos

Honest: pager fires **after commit**. Explorer still titles the **outer** function ([hirosystems/explorer#1699](http://gitmemories.com/hirosystems/explorer/issues/1699)).

### Charisma (2024-09-20/21) — DAO extension + as-contract trait

**183,548 STX** to `SP3M0BBRZEJ8YBMF8WTSE0MHD04F0S9M4FE7DJVPK`. **No exploit tx hashes in sources — do not invent.**

Two complementary primitives: Trojan proposal registers a backdoor **extension** on `SP2D5BGGJ956A635JG7CJQ59FTRFRB0893514EZPJ.dungeon-master`; then `lands` wrap/unwrap dispatch a **malicious SIP-010 `transfer`**. Unwrap uses `as-contract`, so CHA leaves `SP2ZNGJ85ENDY6QRHQ5P2D4FXKGZWCKTB2T0Z55KS.lands` with **`sender === caller === lands`**.

**Would fire (if collecting):**

| Surface | Filter | What you’d see |
| --- | --- | --- |
| Webhook `chain.nested_contract_call.apply` | callee = real `…Z55KS.lands`, `function_name` in `wrap` / `unwrap` / `set-whitelisted` | Inner calls from extension / dungeon-master, **not** an EOA outer `wrap`. |
| Same | callee = `…honey-badger-city`, `function_name` = `burn` | Outer drain tx (still a nested row from whoever `contract-call?`’d it). |
| Subgraph `map_set` | dungeon-master extension map; lands whitelist / `land-balances` / `land-supplies` | Extension set + vault credits without relying on `print`. |
| Index `clock=vm` | `event_type=nested_contract_call&tx_id=` | Call tree Hiro titled as conclude / `burn`. After unwrap `as-contract`: **sender === caller**. |

**Would not:**

- A **`sender !== caller` phishing flag** on the CHA `transfer` (vault path).
- Hiro **callee incoming history** for planter **`propose` on deploy**. Top-level `contract-call?` during publish did not show on the DAO in explorer/Hiro API. If we emit VM `nested_contract_call` **inside deploy txs**, we would still see callee = DAO `propose`, caller = planter `…honey-badger-stxcity`, sender = deployer EOA. If we only tail outer `tx_type=contract_call`, we miss it the same way Hiro did.
- Replay from a published exploit `tx_id` (none in the notes).

### ALEX LABUBU (2025-06-06) — `swap-x-for-y` inner malicious `transfer`

ALEX: **$8,373,227.13**. Signer of the attack steps: `SP2VCNXGRZCBTP8E9MQ6DJPFVXRBPWBN63FE06A1M`. LPs signed nothing.

Hashes from notes (full only when the note had them):

| Role | `tx_id` |
| --- | --- |
| First drain (`amm-pool-v2-01::swap-x-for-y` → `ssl-labubu-672d3::transfer`) | `0xe8b2ac705dcbb35d487a4efd7a0fe384bbad1d1d97ea970410ad82a3cd0d9daf` |
| Privilege `create2` (failed-deploy proof → live malicious wrapper) | `0xfb4822786771285238e082f46bee1203d9ccb9cedfd1b3e6e574a4908d53474f` |
| Second swap (prefix only) | `0xe74617ae…` |
| Failed deploy (prefix only; outer fail → **no `vm_events`**) | `0x46b3a196…` |
| `set-enable-farming` (prefix only) | `0x5069e8ae…` |

**Would fire:**

```
# Index — inner-call tab for the swap Hiro titled swap-x-for-y
GET /v1/index/events?event_type=nested_contract_call&tx_id=0xe8b2ac705dcbb35d487a4efd7a0fe384bbad1d1d97ea970410ad82a3cd0d9daf

# subgraph / webhook — unexpected SIP-010 callee of the AMM
sources: {
  innerTransfer: {
    type: "nested_contract_call",
    contractId: "<amm-pool-v2-01 or ssl-labubu-672d3>",
    functionName: "transfer",
  },
}
# on the drain row: sender === caller (vault as-contract). Do not expect sender !== caller.
```

`create2` / `set-enable-farming` that **committed** are `map_set`/`var_set` on the listing helper — a separate canary, still not prevention of the later swap.

### 100proof class — theoretical / disclosed, `sender !== caller` on `list-in-ustx`

No named mainnet theft in the notes. Gamma-style collections still shipped `is-sender-owner` (`tx-sender or contract-caller`) as of the Feb 2025 sample. Victim signs **`buy-in-ustx`**; inner `commission-trait.pay` → **`list-in-ustx`** on other NFTs; **`map_set market`**; post-conditions see only the purchased NFT send.

```
# webhook the callee, not a chain-wide phishing product
chain.nested_contract_call.apply
  contractId = <collection>
  functionName = list-in-ustx
# alert when sender !== caller (buyer vs malicious comm)
```

Same inequality on CoinFabrik `transfer` phishing and pre-fix BNS-V2 name ops. High false-positive if applied to every DEX `transfer` (proxies/routers look like this by design). BNS-V2 **fixed** (`contract-caller`). sBTC #500 **accepted, not fixed**.

### Bitflow stableswap — unexploited, good synthetic

Audit: public pool create + hostile pool trait + core `as-contract` → inner `set-liquidity-fee` / `set-fee-address` on **existing** pools; auth vs `tx-sender`; **sender === caller**. No production drain found. Use as a **lab tx**: webhook those admin fns on live pool principals; expect map-only fee writes, no extra FT event.

---

## Demo pick (after a collecting node exists)

1. **ALEX `0xe8b2ac70…daf`** — Hiro title `swap-x-for-y` vs our inner `transfer` (confirmed theft, `sender === caller`).
2. **100proof `list-in-ustx`** — synthetic or live collection; `sender !== caller`; map-only (the PC miss).
3. **Bitflow-shaped lab** — `as-contract` admin, unexploited, same vault-class signal as Charisma/ALEX without needing unpublished Charisma hashes.
4. Charisma — tell the **propose-on-deploy / Hiro callee-history** story; do not fake a `tx_id`.
