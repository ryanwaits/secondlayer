# Data-plane wedge: becoming the infra layer for the big Stacks players

> 2026-06-13. ultracode workflow: 7 code-grounded subsystem audits × 8 real-anchor player
> profiles → synthesis → adversarial critique. Anchor numbers from founder-supplied research
> (Zest/Xverse/Fordefi/Asigna/Dune/QuickNode/Foundation/Studio cohort, 2026-06-12).
> Companion: `multichain-ordinals-l1-expansion-2026-06-13.md` (the "don't add chains" pass).
> This pairs with STRATEGY.md; where they conflict, STRATEGY.md wins until amended.

## The honest thesis

The Kourier line — "run the Hiro API without running a node" — is **~70% true and fails on the
last 30% that matters most** (no balances, no nonces, no read-only Clarity call, no BNS resolver
on our index plane). So "node-replacement API" is **not** the wedge we can sell today.

The wedge we **can** win: be the **decoded-semantics data plane for the data Stacks Labs/Hiro
declined to build** —

1. **Decoded sBTC peg-in/peg-out events** — Hiro explicitly declined peg-event filtering
   (stacks-blockchain-api #1709, "not planned"); the *only* first-party tracker is Emily, run by
   the bridge operator. **This is the single sharpest moat.** We already index `sbtc/events`.
2. **PoX-cycle / reward-set decoded events** — raw `pox-4` exists; the per-cycle aggregate
   semantics every stacking product hand-rolls does not.
3. **Decoded Clarity contract-call args** the analytics stack (Dune, Flipside, Artemis, Messari)
   **cannot ingest** — none have native Clarity decoding. They are white-label *customers*, not
   competitors.

We already decode all three, **sign** them (ed25519 responses + manifests + Nakamoto inclusion
proofs), ship them keyless over `/v1`, with a **live x402 agent rail** and MCP/SDK/CLI no other
Stacks provider has. The 2026 move is **packaging + trust-hardening + minimal redundancy**, not a
green-field build. Position as **the maintained successor to Hiro's archived Chainhook**, not a
Hiro replacement.

> Tailwinds (research): Hiro is retreating (deprecated L1 Ordinals/Runes/BRC-20 APIs Mar 9 2026,
> archived Chainhook read-only Feb 25 2026, removing keyless, no subgraph, no agent rail, no raise
> since 2019). The commodity floor is going free; everything above it is open daylight.

---

## DONE-RIGHT — what already serves the thesis (so the answer to "are we ready, just need
## positioning?" is: *the moat data is ready; the trust + reliability wrapper is not*)

| Capability | Evidence |
|---|---|
| Decoded Clarity calls + events over keyless `/v1/index` with uniform cursor+tip+reorgs envelope | `packages/api/src/routes/index.ts:342-661` (events, contract-calls, ft/nft-transfers, blocks, txns, canonical, stacking, mempool, print-schema) |
| sBTC + PoX-4 **already indexed** — the moat substrate exists, just unpackaged | `sbtc/events` + `pox-4` datasets; `decoders/` covers bns/pox-4/sbtc |
| Cryptographic trust: ed25519-signed Streams responses + signed dump manifests + Nakamoto tx-inclusion proofs (re-verifies 70% signer threshold) | `streams/signing.ts`; `sdk/streams/dumps.ts:67-99`; `index/transaction-proof.ts` |
| Direct-chain Subscriptions = maintained successor to archived Chainhook (leader-elected evaluator, reorg apply/rollback, idempotent replay, 2-replica delivery) | `subgraphs/runtime/trigger-evaluator.ts` (13 trigger types); `chain-reorg.ts`; `emitter.ts` (FOR UPDATE SKIP LOCKED + circuit breaker + SSRF guard) |
| Live x402 pay-per-call rail (STX/sBTC/USDCx) + MCP/SDK/CLI — the only Stacks "agentic-readability" rail | `routes/x402.ts`; `.well-known/x402`; prod-live api@1.22.4 |
| Streams parquet→R2 + canonical block-hash + replay-from-height = the parquet-to-S3 shape Dune's dbt add-a-chain ingests | `subgraphs/read-core.ts`; `secondlayer-streams-prod` R2 + cumulative `latest.json`; `canonical.ts` (verbatim Kourier primitive) |

**Critique correction (honored):** the synthesis claimed `measureStorage()` is dead code — it is
**not**. It's fully implemented (`platform/src/db/queries/usage.ts:156`, `pg_total_relation_size`
per tenant schema); what's gated is the worker cron in platform mode. Don't repeat the "dead code"
line.

## ENHANCE — exists but has a real gap for partner use

| Item | Priority | Why / player need |
|---|---|---|
| **Wire `STREAMS_SIGNING_PRIVATE_KEY` into subscription-processor + boot-time fail-loud assert** | **P0** | The ed25519 webhook signature is a **silent no-op in prod** — compose injects only `SECONDLAYER_SECRETS_KEY`, signer returns null, deliveries ship **unsigned** while we market signature verification as the trust story. Same footgun bit Streams once. Breaks every anchor's verify step (Fordefi/Asigna/Zest). |
| **Productize decoded sBTC peg-in/peg-out** as a named typed endpoint + webhook topic (deposit/withdraw/signer-lifecycle/settlement-status) | **P0** | Sharpest moat; only other source is Emily. Substrate (`sbtc/events`) exists — convert to a buyable SKU. |
| **SLA-enabling redundancy** — hot-spare stacks-node + Postgres replica/standby + published uptime/RPO/RTO | **P0** | SLA-criticality is the **only validated true-anchor lever**; the two biggest MRR lines (Zest, Dune) require a *signable* SLA. **Critique: this is mis-scoped as one L item — it's really 3-4 builds** (node hot-spare w/ reorg-consistent cutover, streaming replica w/ defined RPO, indexer leader-failover, published RTO/RPO + status page + runbook). ~a quarter of work. |
| Productize PoX-cycle/reward-set aggregate endpoints (per-cycle semantics) | P1 | StackingDAO, Xverse (largest stacking pool), Stacks Labs, Dune PoX tables |
| Flip $299 Studio (`scale`) tier from manual-deals-only → publicly self-serve (`pricing.ts:58-71` — plan + Stripe keys exist, gated) | P1 | The cohort built for it can't buy it; fixes the $99→$1.5k 15× cliff |
| Phase-1 capacity caps (subgraph slots, stored rows, SSE tails) so Free doesn't cannibalize Studio/Pro | P1 | Self-serve funnel needs upgrade pressure to fund runway between anchor deals |
| Set `STACKS_NODE_RPC_URL` in prod + monitor so tx-inclusion proof stops degrading to 503 | P2 | Asigna/Fordefi need verifiable inclusion for funds-movement |
| JWKS-style multi-key endpoint + rotation overlap window | **P1 (critique re-prioritized from P3)** | One static key shared across Streams + webhooks, hot in 3 envs, **no rotation runbook**. A leak = simultaneous coordinated rotation for every pinned partner = security incident, not a nice-to-have. |

## BUILD — missing, needed for the thesis

| Item | Priority / effort | Player need |
|---|---|---|
| **Account/address read surface** — STX/FT balances, NFT holdings, nonces, `stx_inbound` (verified absent: no `/balances` route) | P1 / L | Xverse, Ryder, D'CENT, Leather — **a wallet cannot cut its Hiro dependency without balances/nonces.** Make-or-break for any "without-a-node" claim. |
| **Co-built liquidation/health-factor SLA webhook** — decoded confirmed-finality collateral-breach stream shaped to Zest v2 (reusable Granite/Velar) | P1 / M | Zest (#1 anchor), Granite, Velar — bespoke, non-portable, displaces orphaned self-hosted Chainhook |
| Read-only Clarity call proxy (`/v2/contracts/call-read`) + contract source on the index plane (not the OSS-only `node.ts` proxy) | P2 / M | Fordefi pre-sign simulation, wallets, Stacks Labs SBA parity — 2nd most-hit endpoint class after balances |
| Wholesale **Dune-conformant `stacks.decoded.*` tableset + dbt connector** (contract_calls, events, sbtc_peg, pox_cycles) parquet→S3, + QuickNode 70/30 add-on | P2 / M | Dune (add-a-chain $3-8k white-label; zero Stacks coverage) + QuickNode (95k+ devs). Sell once, they carry CAC. |
| Genesis-to-tip Streams parquet backfill (windows 1→7.81M; today 42 windows only) | P2 / L | Dune/Artemis add-a-chain lands populated; Zest full liquidation history; Stacks Labs redundant index |
| Minimal partner/tenancy provisioning + per-tenant metering (revive dormant `tenants` table; `projects.ts:297` returns `DEDICATED_PROVISIONING_DISABLED`) | P3 / L | Dune/QuickNode channel + Stacks Labs sponsored access — **Partner Platform Phase 4; build ONLY on named pull** |

---

## Player lock-in map (research-grounded)

| Player | Sharpest wedge | Realistic $ | Confidence | Why they DON'T buy |
|---|---|---|---|---|
| **Zest** (#1 anchor; 60-79% of Stacks DeFi TVL) | SLA liquidation webhook (confirmed-finality health-factor breach) as the **maintained successor to their orphaned self-hosted Chainhook** + decoded peg + x402 keeper rail | $3-5k, $8k on L1 vaults | **high** | Self-hosts Chainhook; thin protocol rev (~$42k/yr) → check rides VC treasury; SLA trust on one box |
| **Stacks Labs** (inherited Hiro's API mandate, $27M 2026 budget) | Sell the peg/PoX surface **their team declined to staff** (SBA #1709) as a co-built "Agentic readability" API surface + x402 rail | **$0 recurring near-term**; one-time $25-50k grant/bounty; $3-8k/mo only if a decoded surface becomes load-bearing in their API | medium | **They ARE the incumbent** — own the SBA codebase + consolidated Hiro/TM/Foundation devs in-house; budget routes through Foundation grants (one-time ≤$50k). Selling the displacement tool to the displacement target. |
| **Xverse** (~1.5M users, pays Hiro tiers, sBTC signer) | Decoded peg + PoX feed to their signer/stacking/Earn surfaces — the one class they don't index | $1.5-3k floor; $5k+ only if load-bearing | medium | "Everything in-house," resells own API → competitor; Stacks a minority surface |
| **Fordefi** (institutional MPC, ~$8B/mo) | Decoded peg lifecycle wired into pre-sign **transaction simulation** | $1.5-3k; $5k if load-bearing | medium | Stacks a minority of multichain volume; custody "own the stack" culture |
| **Asigna** (institutional multisig, $1.1B+ AUM) | Co-signer webhooks + decoded multisig-call rendering + peg as expansion | $1.5-3k | medium | Stacks 1 of 5 chains; budget may route via Trust Machines (investor) |
| **Dune + QuickNode** (white-label channel) | `stacks.decoded.*` add-a-chain via parquet→S3/dbt — the dataset **no analytics vendor has** | Dune $3-8k license (committed); QuickNode rev-share (upside, $0 floor) | medium | Stacks may not clear Dune's demand bar; both could write a Clarity decoder once; $1B-org procurement is slow |
| **Stacks Foundation** | Foundation-funded "Agentic Readability" public good — **grant + first-customer** (Signal21 template), with sponsored grantee access | **$0/mo** — one-time ≤$50k grant; never model monthly | high | 2026 spend cut ($25M→$19M); neutrality (won't anoint one vendor); already funds Signal21 |
| **Studio cohort** (Bitflow, Velar, Hermetica, Gamma, Ryder, DIA, StackingDAO, Granite…) | Self-serve $299 peg/PoX + liquidation/issuance webhooks | $1.2-2.4k cohort run-rate (4-6 of 10 convert) | medium | Many self-host (Bitflow 350GB SBA); Leather free-in-family; tier isn't even publicly buyable yet |

---

## The $30k MRR path — modeled vs. adversarial

**Synthesis model (optimistic): ~$26k/mo** — 1 Zest @ $4k, 1 Dune license @ $4k, 1 wallet/custody
Enterprise @ $3k, 2 low-Ent (Granite/StackingDAO) @ $1.5k, 6 Studio @ $299, 60 Pro @ $99,
QuickNode rev-share @ $4.5k.

**Adversarial re-derivation (credible 12-month): ~$6-9k/mo.** The board-member pass strips it:

- **Pro $99** is the only floor independent of anchors — but 60 paying from a 30-80 funded-team
  universe is 75-200% capture of a mostly-free-tier-satisfied market. Realistic: **12-25 Pro = $1.2-2.5k**.
- **Studio $299** needs the public flip (real, S-effort) but the cohort self-hosts / is free-in-family.
  Realistic: **2-4 = $0.6-1.2k**.
- **Zest** self-hosts Chainhook, ~$42k/yr rev, 9-12mo sales cycle → model **$0-4k × ~30% close ≈ $1.2k expected** inside 12mo.
- **Dune** = $1B-org procurement, minority chain → **~$0-1k** inside 12mo.
- **QuickNode** rev-share = **$0** until adoption (the plan's own "softest line").
- **Wallet/custody Enterprise** needs balances + call-read which **don't exist yet** (L-effort each) → **$0-1.5k**.

**Bottom line on the number:**
- **$6-9k** = credible 12-month landing.
- **$18-22k** = achievable in 2-3 quarters **only if** the SLA-redundancy build ships **and** ≥2 of
  3 anchors convert.
- **$30k+** = a **24-36 month** target, not a 12-month one. Don't put $30k on a 12-month plan.

**The binding constraint isn't features — it's throughput.** A 1-2 person team cannot
simultaneously close 3 enterprise anchors (9-12mo cycles each), run a Dune procurement, build
redundancy + balances + peg SKU + PoX SKU, **and** service self-serve. The roadmap below is an
18-24mo backlog; sequence it against human bandwidth, not against the org chart of wants.

### Risks the plan must carry (from the critique)

1. **No second source of chain truth.** Everything (peg, PoX, reorg-correct webhooks) derives from
   **one** self-hosted node + **one** decoder. A silent decoder bug or node fork ships *wrong
   settlement-status* to a lending/custody partner — worse than downtime. Redundancy is scoped as
   *availability*, not *correctness*. **Add: reconcile peg events against Emily; canary against a
   second node.**
2. **Zest concentration.** Zest is 60-79% of Stacks DeFi TVL **and** Anchor 1 **and** a bespoke
   non-portable co-build. If Zest churns/keeps free Chainhook, the anchor line **and** the sunk
   build evaporate. Existential single-customer dependency.
3. **Stacks Labs budget is unvalidated.** The whole "power the API" thesis points at them, but it's
   unknown whether they have a *recurring* budget or only route Foundation grants (one-time ≤$50k).
   **Do not count Stacks Labs as recurring MRR until answered.**
4. **x402 sponsor exposure.** Gas paid from a hot sponsor key (~200 STX) is an unbounded
   outflow/griefing surface at agent scale — no per-caller cap or circuit-breaker in the roadmap.
   It's a liability, not pure upside.

---

## Sequencing — what to do, in order (respecting the 2-person ceiling)

1. **Do first (hours): wire the webhook signing key + boot assert.** Verified-real silent integrity
   hole — every "signed" webhook ships unsigned today. A partner discovering our headline signature
   is a no-op kills the deal faster than any missing feature. Non-negotiable before any outbound.
2. **Package the moat (M): peg-in/peg-out SKU + PoX-cycle endpoint.** Converts existing data into the
   thing no one else has. Cheap relative to value. Unlocks every player conversation.
3. **Make an SLA signable (the real quarter of work): node hot-spare + DB replica + Emily
   reconciliation + status page + runbook.** Gates Zest and Dune — the two biggest lines. Scope as
   3-4 items, not one.
4. **Self-serve floor (M): flip $299 Studio public + Phase-1 caps.** The bandwidth-cheap revenue that
   funds runway between anchor deals; independent of the SLA build.
5. **Then the wallet surface (L): balances/nonces/holdings + call-read.** Unlocks wallet-Enterprise
   and the honest "without-a-node" claim — but it's large; don't front-load it before the moat + SLA.
6. **On named pull only: Dune dbt tableset, QuickNode add-on, tenancy plane.** Demand-before-supply.

## Positioning (two layers, no overclaiming)

- **Keep** the self-serve product as it sells today (curl decoded data in 10s; deploy a one-file
  indexer) — honest, converts Pro/Studio.
- **Add** a data-plane/partner narrative (currently invisible — grep of `apps/web` for
  hiro/stacks-labs/leather/xverse/partner returns nothing). Lead with the one thing nobody has:
  **the only productized decoded sBTC peg + PoX-cycle feed on Stacks** — the data Hiro declined
  (SBA #1709) and the analytics stack can't ingest — signed, reorg-correct, replayable.
- **Frame as** the maintained successor to Hiro's archived Chainhook. **Guardrails:** do NOT claim
  "run the Hiro API without a node" until balances + call-read ship; do NOT claim an SLA until the
  hot-spare + replica exist (sell best-effort + an Enterprise SLA addendum). Foundation = bounty +
  first-customer, never a subscription. Dune/QuickNode = wholesale add-a-chain licensing, not SaaS.
- Use the **Kourier lineage** as a credibility signal in outbound to Stacks Labs / wallets, paired
  with honest scope: *we are the decoded-event + peg/PoX data plane and the firehose you build your
  index on — not yet the complete node-replacement API.*

## Open questions for the founder

1. **Stacks Labs:** independent recurring budget, or Foundation-grant-routed only? Determines whether
   they're an anchor or a bounty.
2. **Zest:** are we comfortable with a bespoke co-build for a customer that is also our single
   biggest concentration risk? What's the de-risking (portable primitive, multi-customer from day 1)?
3. **SLA appetite:** willing to commit the ~quarter of redundancy work that gates the two biggest
   lines, before any anchor has signed? (Chicken-and-egg: the SLA build is what makes the anchor
   signable, but the anchor is what justifies the build.)
4. Does the $299 Studio flip + caps happen now (bandwidth-cheap, founder-decision on the locked
   ladder), independent of all anchor work?
