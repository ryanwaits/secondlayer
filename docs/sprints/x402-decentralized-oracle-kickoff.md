# x402 Price Feed → Decentralized Stacks Oracle — Exploration + Implementation Kickoff

> Paste into a fresh session: "Read docs/sprints/x402-decentralized-oracle-kickoff.md.
> Do Sprint 1 first — a deep, skeptical review of decentralized price-oracle options on
> Stacks for x402 USD pricing, ending in a decision matrix + a single recommendation you
> defend. STOP and show me the recommendation before writing any feed code. Then implement
> the chosen oracle behind the existing SpotResolver seam with manipulation resistance and
> tests."

## Why this session exists

The x402 rail (LIVE in prod since 2026-06-12) prices non-stable assets (STX→USD, sBTC→BTC/USD)
from **CoinGecko's free REST API**. A v1 patch (see `x402-spot-feed-fix-kickoff.md`, shipped)
made that feed robust — throttled retries, backoff, warm boot, env fallback — but CoinGecko is
still: centralized, rate-limited (~5 rapid calls → 429), off-chain, censorable, and not
crypto-native. For a pay-per-call rail that an autonomous agent trusts to price its payment,
the price source should be **decentralized, on-Stacks, and manipulation-resistant** — ideally
derived from data we already index.

Goal: replace (or quorum-blend) CoinGecko with a decentralized price feed for **STX/USD** and
**BTC/USD** (for sBTC), without regressing the rail's "never block a request, degrade to
USDCx-only rather than misprice" contract.

## Architectural north star (read before researching)

**We are an indexer, not an RPC consumer.** The x402 reconciler deliberately confirms payments
against OUR OWN `decoded_events` (canonical-gated), staying Hiro-free and self-contained
(`packages/api/src/x402/x402-reconcile.ts` header). The most on-brand oracle is the same shape:
**derive USD prices from on-chain DEX state we already decode** (pool reserves / swap events in
`decoded_events`), compute a TWAP, and never leave our own data plane. Evaluate external pull-
oracles (Pyth / RedStone) as the alternative, but weigh them against this self-contained ideal.

## The integration seam already exists (don't rebuild it)

- `packages/api/src/x402/spot.ts` — `spotUsd(symbol)` is the single price source. Fallback chain
  today: live cache → `X402_SPOT_<SYM>_USD` env override → null. A new oracle slots in HERE.
- `packages/api/src/x402/middleware.ts:136` `buildAccepts({ spot })` already takes an injectable
  `SpotResolver = (symbol) => number | null`. `null` ⇒ asset dropped from `accepts[]` ⇒ offer
  degrades to USDCx-only. Preserve this exactly.
- `packages/stacks` — read-only contract calls (public client / `readContract`, `getContract`)
  for pulling on-chain pool/oracle state. sBTC contract is
  `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`.
- Our Index plane (`decoded_events`) — already decodes Stacks contract calls; DEX swaps/reserves
  are queryable here without any external RPC.

## Sprint 1: Deep review (READ-ONLY — produce a decision, write no feed code)

Survey and SKEPTICALLY evaluate every viable decentralized price source for STX/USD + BTC/USD on
Stacks mainnet. At minimum investigate:

- [ ] **On-chain DEX TWAP from our own index** — Velar, Bitflow, ALEX STX/stablecoin + sBTC/
      stablecoin pools. Which stablecoin has real depth (aeUSDC/Allbridge, USDA/Arkadiko, USDh/
      Hermetica, sUSDT)? Read reserves or swap history from `decoded_events`. Pros: zero external
      deps, censorship-resistant, on-brand. Cons: liquidity depth, stablecoin peg assumption,
      single-block manipulability (→ needs TWAP + sanity bounds).
- [ ] **Pyth Network on Stacks** — is there a live mainnet Pyth receiver contract? Pull model
      (Hermes off-chain price service + on-chain verify). Freshness, cost, decentralization,
      whether it reintroduces an off-chain HTTP dep like CoinGecko.
- [ ] **RedStone** — widely used by Stacks DeFi (Granite/Zest/Bitflow). Pull oracle, signed price
      payloads. Same question: does using it for OFF-chain 402 pricing just swap one HTTP gateway
      for another, or can we verify their signed feed self-contained?
- [ ] **DIA** — Stacks feeds? push cadence, asset coverage.
- [ ] **Arkadiko / protocol oracles** — collateral-pricing oracles already on mainnet; readable?
- [ ] **Sanity reference** — keep CoinGecko (post-patch) as one input to a median, not the truth.

Evaluation axes (score each, 1–5): decentralization/censorship-resistance · manipulation-
resistance · freshness/latency · STX + BTC coverage · liquidity/robustness · integration cost ·
**fit with our indexer-native architecture (no external RPC)** · ongoing-maintenance burden.

→ **Deliverable**: `docs/audits/x402-oracle-options-<date>.md` — the matrix + ONE recommended
design you can defend (likely a quorum: on-chain DEX TWAP as primary + a second source for
median + env fallback). STOP here and show the founder before Sprint 2.

## Sprint 2: Spike the recommendation behind the seam
- [ ] Build a throwaway script that computes STX/USD + BTC/USD via the chosen method against
      mainnet (read pools from `decoded_events` / contract reads via `packages/stacks`). Print the
      number next to live CoinGecko + a CEX reference; quantify drift. → validates: within a few %
      of market across a few hours of spot-checks.

## Sprint 3: Implement (manipulation-resistant, never-block)
- [ ] New resolver module (e.g. `packages/api/src/x402/oracle.ts`) implementing `SpotResolver`.
- [ ] **Manipulation resistance**: TWAP/median over N blocks (we have the history indexed), NOT a
      single-block spot; cross-source median where >1 source exists; reject prices outside a sane
      band vs the last accepted value (circuit breaker → fall through, don't misprice).
- [ ] **Staleness + degrade**: bounded max-staleness; on stale/unavailable → env override → null
      (drop asset), mirroring `spot.ts`. NEVER block a request on an oracle read.
- [ ] **Compose**: chain oracle → CoinGecko (patched) → env override as a fallback ladder, or a
      median quorum — per Sprint 1's decision. Keep `X402_SPOT_URL` / `X402_SPOT_*_USD` envs as
      ultimate static fallbacks.
- [ ] Unit tests: TWAP math, circuit-breaker rejection, staleness, degrade-to-USDCx, quorum
      median. Reuse the `spot.test.ts` patterns (injectable resolver, fake feeds).

## Sprint 4: Ship
- [ ] `/check` → changeset (`@secondlayer/api` patch; + `@secondlayer/stacks`/`shared` if helpers
      land there) → `/release` → push (Deploy). Update `/v1/x402/supported` discovery if the price
      provenance is surfaced.
- [ ] Prod-verify: live 402 STX/sBTC amounts track the oracle within band; kill CoinGecko egress
      from a container and confirm graceful fallback; grep logs for circuit-breaker trips.

## Hard rules
- Sprint 1 is READ-ONLY and ends in a written recommendation — no feed code until the founder
  picks the design.
- Preserve the rail contract: never block a request; degrade to USDCx-only over mispricing.
- Prefer self-contained (our `decoded_events`) over reintroducing an external HTTP oracle gateway,
  unless Sprint 1 proves on-chain liquidity is too thin to price safely.
- Manipulation resistance is non-negotiable: a payer must not move a DEX pool one block to cheapen
  their own 402. TWAP + bands + quorum.
- Work off `main`; single conventional-line commits; changeset for changed packages.

## Open questions for the founder (answer during/after Sprint 1)
- Acceptable price granularity for sub-cent ($0.001) 402s? (Looser tolerance = simpler/safer
  oracle.)
- Single decentralized source, or a median quorum (DEX TWAP + RedStone/Pyth + CoinGecko sanity)?
- Is reintroducing ANY off-chain gateway (Pyth Hermes / RedStone) acceptable, or strictly
  on-chain/own-index only?
- Which Stacks stablecoin do we trust as the USD leg (aeUSDC vs USDA vs USDh …)?
```
