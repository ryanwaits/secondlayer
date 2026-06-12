# x402 Price Feed → Decentralized Stacks Oracle — Sprint 1 Decision

> Read-only skeptical review per `docs/sprints/x402-decentralized-oracle-kickoff.md`.
> Deliverable: option matrix + ONE defended recommendation. **No feed code until the
> founder picks.** Date: 2026-06-12. All contract addresses / freshness on-chain-verified
> via Hiro mainnet on this date.
>
> **FOUNDER DECISIONS (2026-06-12):** (1) Quorum = **DIA primary + CoinGecko ±5% band**
> (2 legs now; Arkadiko only if needed later). (2) DEX-TWAP-from-our-own-index = **KILLED**
> — DIA + CoinGecko is the long-term answer; do not build DEX decoders for pricing.

## TL;DR

Replace CoinGecko's primary role with the **DIA on-chain oracle** (`SP1G48FZ4Y7JY8G2Z0N51QTCYGBQ6F4J43J77BQC0.dia-oracle`), read via a single `packages/stacks` `readContract` against **our own stacks-node**, and keep **CoinGecko (post-patch)** as a median/sanity cross-check + secondary fallback, then env override → null. This is the kickoff's hypothesized quorum — but DIA replaces the **un-buildable** DEX-TWAP-from-our-own-index as the on-chain leg. The DEX TWAP is deferred (documented as a future trust-minimization upgrade), not chosen.

Three kickoff premises were wrong and changed the answer:
1. **DEX-TWAP-from-our-own-index isn't buildable today** — we decode zero DEX data, and the underlying liquidity is too thin/single-DEX to price safely (~$750 moves the deepest pool 1%).
2. **RedStone is dormant on Stacks** (a 2021 verifier lib, no price store). Granite/Zest actually use Pyth; Hermetica uses DIA.
3. **Pyth is being sunset on Stacks — EOL 2026-07-31** — and its on-chain read is months-stale because nobody keeps it warm.

## The "no external RPC" north star, clarified

The kickoff's ideal is "never leave our own data plane." Reading any on-chain oracle needs **one node RPC call** — but that call hits **our own stacks-node** (`node-server`, `reference_hiro_node_topology.md`) for **on-chain, signed/consensus data**. That is categorically different from trusting CoinGecko's or Pyth-Hermes's **off-chain price HTTP API**. So "read DIA via our own node" satisfies the spirit (crypto-native, censorship-resistant, our infra) even though it isn't a SQL read of `decoded_events`. The only literally-zero-RPC option is the DEX TWAP from `decoded_events` — and that substrate doesn't exist and is fragile (below).

## Option matrix (1–5; higher = better)

| Axis | DEX-TWAP (own index) | **DIA on-chain** | Pyth | RedStone | Arkadiko | CoinGecko (incumbent) |
|---|---|---|---|---|---|---|
| Decentralization / censorship-resist | 5 | 3 | 4 | — | 3 | 1 |
| Manipulation-resistance | 2 | 4 | 5 | — | 4 | 3 |
| Freshness / latency | 4 | 5 | 1 | — | 3 | 5 |
| STX + BTC coverage | 3 | 5 | 4 | — | 3 | 5 |
| Liquidity / robustness | 2 | 4 | 5 | — | 3 | 5 |
| Integration cost | 1 | 4 | 2 | — | 4 | 5 |
| Indexer-native fit (no off-chain HTTP gateway) | 5 | 4 | 2 | — | 4 | 1 |
| Maintenance burden | 2 | 4 | 1 | — | 3 | 3 |
| **Total** | **24** | **33** | **24** | **dead** | **27** | **28** |

### Per-option verdicts

**DIA on-chain — RECOMMENDED.** `...dia-oracle`, live and actively pushed by a long-running relayer (updater wallet nonce ~62k). Read-only `get-value(key)` → `(optional (tuple (timestamp uint) (value uint)))`, 8-decimal USD, **no off-chain HTTP at read time**. Verified on 2026-06-12: STX/USD ≈ $0.179 (matches reality — the spot-feed-fix doc's live STX), BTC/USD ≈ $63,402, **sBTC/USD ≈ $63,783** all timestamped minutes before query. Free to consumers (DIA pays gas). **Catch:** centralized writer — a single `oracle-updater` principal gates the key/value store (rotatable via `change-oracle-updater`); no on-chain threshold/proof at the Stacks layer, so you trust DIA's off-chain aggregation + one relayer key. Manipulation-resistance comes from DIA aggregating many venues off-chain — you can't cheapen a 402 by moving one Stacks pool. **It is the only option that genuinely replaces a CoinGecko-style HTTP read with a self-contained on-chain read AND covers sBTC directly.**

**DEX-TWAP from our own index — DEFER (not buildable now).** Our decoder emits only asset-movement primitives (`ft/nft/stx_transfer|mint|burn|lock`) + curated `sbtc/pox4/bns` projections + a generic `print` (`packages/indexer/src/l2/storage.ts:18-80`). **Zero** Velar/Bitflow/ALEX swap or reserve decoders exist (grep-confirmed). To price from our own plane we'd first build per-DEX `print`-payload parsers (DEX swap prints already land in `decoded_events.payload` un-typed — cheapest path, template `readPrintSchemaWindows` `packages/api/src/index/print-schema.ts:65-89`, read via `getSourceDb()` exactly like `x402-reconcile.ts:85-95`). Even then the substrate is fragile: deepest STX pool is Bitflow STX/USDCx (~$300–800K) / STX/aeUSDC (~$309K); **~$750 of recoverable capital moves it 1% in one block**; essentially all usable depth is on **one DEX (Bitflow)** with no second deep venue to cross-validate; BTC needs a 2-hop sBTC→STX→stable route. Mandatory multi-block TWAP + bands. High build cost on a thin, single-point-of-failure base — not justified when DIA already delivers the on-chain self-contained property across STX+BTC+sBTC.

**Pyth — REJECT.** `SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-oracle-v4`. Strongest provenance (Wormhole-guardian-signed), but (1) **Stacks support ends 2026-07-31** per Pyth's own docs — do not build a long-lived dep; (2) the on-chain stored price is days-to-months stale (~32 lifetime txs, nobody relays); (3) a *fresh* price requires fetching a VAA from the off-chain **Hermes HTTP** endpoint + paying STX to post it — i.e. it reintroduces exactly the off-chain HTTP gateway we're trying to drop.

**RedStone — REJECT (dormant).** Only artifact is `SPDBEG5X8XD50SPM1JJH0E5CTXGDV5NJTKAKKR5V.redstone-verify`, a stateless 2021 verifier lib that stores no prices. No on-chain price store to read; always needs an off-chain signed payload. Not a current rail.

**Arkadiko — VIABLE BACKUP, not primary.** `SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-oracle-v2-4`. Readable on-chain, multi-signer signed-push (STX, BTC, DIKO, USDA), self-contained — better trust distribution than DIA's single key. But admin-permissioned (Arkadiko DAO controls the signer whitelist/quorum) and purpose-built for their own CDP collateral, no sBTC. Good as a third quorum source if we want to dilute DIA-single-key risk later.

**CoinGecko (post-patch) — KEEP as sanity/fallback, demote from primary.** Now robust after the retry-storm fix (`packages/api/src/x402/spot.ts`): 5-min cadence, 429 backoff, warm boot. Fast, broad, accurate — but centralized, censorable, off-chain, rate-limited. Ideal role: the independent second leg for a median/band check against DIA, and the secondary fallback when DIA is stale.

## Recommended design (defend, don't build yet)

A **fallthrough ladder with a cross-source circuit breaker**, slotting into the existing `SpotResolver` seam (`spot.ts` → `buildAccepts({ spot })`), preserving the never-block / degrade-to-USDCx contract:

1. **Primary — DIA on-chain.** `readContract` `get-value` for STX/USD, BTC/USD (and sBTC/USD directly — better than deriving from BTC). Reject if DIA's on-chain `timestamp` is older than a staleness bound (e.g. 30 min) → fall through.
2. **Circuit breaker / median sanity.** When CoinGecko is available, reject the DIA value if it deviates from CoinGecko beyond a band (e.g. ±5%) → fall through rather than misprice. (Two independent sources = the kickoff's quorum; a 3rd, Arkadiko, can be added later to vote.)
3. **Secondary — CoinGecko (patched).** Existing cache path.
4. **Fallback — `X402_SPOT_<SYM>_USD` env override → `null`** (asset dropped → USDCx-only). Unchanged.

Manipulation resistance: DIA's off-chain multi-venue aggregation means a payer can't move a Stacks pool to cheapen their 402 (the DEX-TWAP's core weakness). Staleness bound + cross-source band + degrade-don't-block are all preserved. For sub-cent ($0.001) 402 pricing, a 5-min/±5% tolerance is ample.

Caching: read DIA via the same stale-while-revalidate cache shape as `spot.ts` (a node RPC per request would be wasteful and reintroduce a per-request external call) — fire a background `readContract` on a coarse cadence, serve last-known synchronously.

## Why DIA over the on-brand DEX TWAP (the one real tension)

The kickoff's stated ideal is the DEX TWAP because it's literally our own `decoded_events`. But: (a) it doesn't exist — it's a multi-week build of per-DEX decoders; (b) the liquidity it would read is thin and single-DEX, so even built well it's the *least* manipulation-resistant option (score 2) without heavy TWAP+band machinery; (c) DIA gives us the same properties we actually want from "on-brand" — on-chain, censorship-resistant, crypto-native, our-own-node read, STX+BTC+**sBTC** — for a single `readContract` instead of a decoder fleet. The DEX TWAP's only edge is literal-zero-RPC, which DIA gives up for one call to *our own* node. Not worth the build/fragility now; revisit if we index DEX swaps for product reasons anyway.

## Founder questions — resolved 2026-06-12

1. **DIA single-writer-key trust** — ✅ RESOLVED: **DIA + CoinGecko ±5% band** (2 legs). Arkadiko deferred as an optional 3rd vote only if DIA single-key risk proves real.
2. **DEX TWAP** — ✅ RESOLVED: **KILLED.** Not deferred. Do not build DEX decoders for pricing; DIA + CoinGecko is the long-term answer.

Still to confirm in the Sprint 2 spike (not blocking):
- **sBTC** — price off DIA's `sBTC/USD` key directly (recommended; sBTC pegs 1.0003 to BTC), or off `BTC/USD`. Trivial either way.
- **Node for the read** — confirm `packages/stacks` `readContract` targets OUR stacks-node, not Hiro, to stay self-contained (`reference_hiro_node_topology.md`).
- **Thresholds** — confirm ±5% deviation / 30-min staleness for $0.001-scale pricing.

## Next step (Sprint 2, on approval)

Throwaway spike: `readContract` DIA's STX/USD + BTC/USD + sBTC/USD on mainnet, print next to live CoinGecko + a CEX reference, quantify drift over a few hours. Validates within a few % before any resolver code lands. **Verify first:** the exact DIA key strings (e.g. `"STX/USD"`) and the v-suffixed read-fn ABI, and that our `readContract` targets our own node.
