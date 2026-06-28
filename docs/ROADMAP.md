# Roadmap — deferred & flagged work

> Canonical prioritized backlog of work we've consciously deferred, so it isn't lost.
> `STRATEGY.md` holds strategic direction and wins on positioning conflicts; this is the
> tactical TODO that hangs off it. Add items when you defer something; delete when shipped.
> Last updated 2026-06-27. **`/v1/index/sbtc/summary` aggregate SHIPPED** (route
> `routes/index.ts:777` + OpenAPI; scoreboard reader `sbtc-peg.ts:933`).
> **sBTC peg read + lifecycle SKU SHIPPED 2026-06-13**
> (typed `/v1/index/sbtc/*` endpoints + confirmed-finality gating). **sBTC webhook topics
> SHIPPED 2026-06-14** (`shared@6.34.0` / `subgraphs@3.15.0`: 4 `ChainTrigger` types +
> `emitSbtcOutbox` evaluator path). **PoX reward-cycle aggregates SHIPPED 2026-06-14**
> (`/v1/index/pox/cycles` + `/v1/index/pox/cycles/:reward_cycle`). **P1 webhook signing +
> trial enforcement SHIPPED** (signing key wired `d9b5d342`; trial gate + 14d + quota=0
> `ffc2c0ed`). Remaining peg work = BTC settlement confirmer + Peg Explorer. Slot
> caps still open (blocked on founder per-plan numbers).

## ✅ P0 — Genesis-complete every decoder (RESOLVED 2026-06-21)

> Plan: ~~`docs/sprints/genesis-decoder-backfill/plan.md`~~ (deleted as completed, commit
> `930f9563`). The index service's core contract is **every
> block from genesis, decoded + supplied** (the SDK's whole pitch). Audit 2026-06-20 found 7 decoders
> floored at ~6.8M (`stx_*`, `nft_*`) + `print`; all now backfilled to genesis via
> `backfill-from-firehose.ts` (parallel-to-live, no lag) cheap→heavy, `stx_transfer` last. Final floor
> audit: all decoders at their genesis/deploy floor, ~49M events, 0 errors. `print` replayed genesis→tip.
>
> **DONE:** Sprint A (register 7 decoders), Sprint B (run + verify all genesis), Sprint C guard
> (`floor-audit.ts` + tests, committed `93990828` — compares each decoder's live floor to a recorded
> baseline; fails on a floored or unbaselined decoder).
>
> **Remaining (don't lose):**
> - [ ] **Wire `floor-audit.ts` into CI/cron** — built + committed but currently **on-demand only**
>   (`bun run src/decode/floor-audit.ts`). Add to prod-smoke or a cron with prod DB creds so a future
>   go-forward decoder can't silently ship floored. This is the durable regression guard; without
>   scheduling it, nothing runs the check.
> - [ ] Reindex hosted subgraphs off the now-complete history: **sbtc-flows** (→ 5321 deposits, in
>   progress) + **bns-names** (from BNS-V2 deploy 167484).

## ⚡ Indexing speed — NEXT (the core service, all tiers)

> Plan: ~~`docs/sprints/indexing-speed/plan.md`~~ (deleted as completed working doc, commit
> `930f9563`; T1+T2(b) were marked done before deletion — re-audit live throughput before
> resuming Sprint 2/3). Analysis: `docs/internal/audits/reindex-performance-2026-06-20.md`
> (still present). Indexing IS the product, and it's slow:
> **measured 27 blk/s** active region → **~16h full sBTC reindex** (live, 2026-06-20). Targets: sBTC
> 5–10 min, pox 20 min. Make it fast for free/self-host AND every paid tier — backfill *speed* is the
> paid lever; the data stays open/keyless. **Root cause is NOT yet confirmed** (the audit's first
> guess — a jsonb scan — is wrong for the subgraph path; `decoded_events` is indexed). Profile first.

- **Sprint 1 — diagnose + universal quick wins (★ highest leverage, every tier, no new data plane).**
  T0 per-reindex throughput metrics; **T1 profile** (fetch- vs scan- vs write/commit-bound — the fix
  branches on this); **T2 skip the wasted `walkTransactions` call** for event-only subgraphs
  (confirmed real at `block-source.ts:202`, nearly free, possibly most of the win); T3 batch-size
  tune; T4 close any index gap T1 finds.
- **Sprint 2 — parallel block-range workers (★ Nx, every tier, no new data plane).** T5a partition N
  workers over FINALIZED history only (reorg-safe); **T5b write-path partition-safety BLOCKER** —
  insert + commutative `ctx.increment` parallelize, but order-dependent `upsert` projections
  (`withdrawals`/`delegations`/pox `stackers`) need a `_block_height`-guard or serial post-pass; T5c
  checkpoint-merge + crash-resume; T5d live-tail handoff; T6 per-tier worker caps (prod-gate for T5).
- **Sprint 3 — R2 parquet fast-lane (paid differentiator; GATED).** Entry condition: HTTP path proven
  insufficient after Sprints 1–2. Hard dep: genesis dump backfill (P2 below). T7 R2 reindex source +
  T7b correctness gate/rollback (decoder-skew risk); T8 tier-gate + HTTP fallback; T9 per-tier SLOs.

Highest-leverage order: **T1+T2** (cheap, likely big) → **T5a–d** (biggest universal win) → **T7**
(biggest single speedup, but gated). Open: per-tier worker caps (founder #); meter backfill by
block-span or bundle; free gets parallel workers (MIT) but not hosted R2 dumps.

## Positioning & marketing — viral-principles audit (2026-06-13)

> Source: ultracode workflow scoring the site/STRATEGY/pricing against the "32
> principles of a viral product" (compass, not checklist). Three debates all
> landed HIGH confidence. Core finding: the marketing sells the *category*
> ("the hosted indexer for Stacks") with copy a competitor could paste, hides the
> one paste-proof claim (decoded sBTC/PoX/Clarity data Hiro declined) in internal
> docs, and has no founder, no proof, no comparison. Honesty guardrail throughout:
> claim "decoded sBTC/PoX/Clarity" (true, shippable), never "run the Hiro API
> without a node" (false until balances/call-read ship). Sequence:
>
> **A (this week, S, copy-only)** spear + free-reframe + founder face + numbers →
> **B (M)** real keyless curl demo + vs-Hiro table + Read/Own/Build ladder →
> **C (gated)** named sBTC peg SKU promotion, behind the data-plane build.

**A — ship now (S, copy-only, no infra risk):**

- **Kill the generic H1; lead with the niche.** "Index the chain. Own your API."
  fails the paste test (Goldsky/Alchemy/Hiro could run it unchanged). Replace with
  a niche-forward, paste-proof spear: *"The decoded Stacks data Hiro won't build."*
  or *"Decoded Stacks data. One curl. No key."* Write 5, recall-test on real Stacks
  devs, keep the sticky one. Promote the buried pain line ("the indexing every
  Stacks team rebuilds") from the final CTA into a hero empathy lede. Files:
  `apps/web/src/app/(www)/page.tsx`, `socialMeta` title, `lib/og`.
- **Put the founder on the site.** All-"we" wall is the biggest untapped trust
  asset — a 2-person team vs a $27M incumbent wins only on the one thing nobody can
  clone: 6 years in Stacks. Add a hero/footer byline ("Built by Ryan Waits — 6
  years indexing Stacks; I built the thing I kept rebuilding"), an `/about`
  manifesto, an x.com handle. Files: `apps/web/src/components/site-footer.tsx`, new
  `/about` route.
- **Reframe free as three honest states** (see Pricing section below for the plan):
  PLAY = keyless curl (no account) · FREE = self-host (MIT, `docker compose up`) ·
  PAID = hosted. Stop fusing keyless reads with the free authenticated plan in copy.
  The OSS-honest line *"Free if you self-host. Paid if we host it. Keyless reads
  free either way."* is copy only this founder can write — make it a brand asset,
  not a buried fact. Files: STRATEGY.md, README, `llms.txt`, pricing page, FAQ.
- **Numbers, not adjectives.** Site is drowning in mechanism ("cursor-paginated,
  reorg-aware") and starved of falsifiable numbers it already computes. Wire
  hero/feature/demo metrics to live `readStatusSnapshot` values (events indexed,
  blocks-behind-tip, p50 latency, # public subgraphs) — or label them sample.
  Fake-precise console numbers (99.9%/1.2s) contradict the honesty brand. Add a
  live proof strip above the footer. Effort: **S-M**.

**B — near (M, small build):**

- **Real keyless curl-in-browser in the hero.** Today's hero demo is a fake
  animated pane; the whole positioning rests on the 10-second keyless curl yet the
  page never lets you run one. A single input → real `GET /v1/index/...` →
  rendered decoded JSON. Highest-leverage single change on the site (principles
  10/25). Make "Run it →" the primary CTA; demote `bun add` + "Read the docs" to
  secondary. Infra already exists (keyless `/v1`).
- **`/vs-hiro` honest comparison table.** Directly counters the named #1 objection
  ("free Hiro"). 9 axes already written in the data-plane audit; include the rows
  Hiro still wins (balances/nonces) so the rows we win are unassailable. Title:
  "What Hiro stopped maintaining, we run as a product." Link from hero.
- **Restructure the 5-card spray into a Read→Own→Build ladder.** One spear front
  door, three depths mirroring the real Streams→Index→Subgraphs architecture: Read
  (Index, keyless) → Own (Subgraphs, the paid/weighted rung) → Build (Streams).
  Drop Subscriptions + CLI from the homepage grid (features/channels, not
  products). Keeps all three products real in nav/docs/STRATEGY — marketing
  front-door change only. Update `www.smoke.test.tsx` assertions.
- **OG images as thumbnails.** Each route's OG carries one provable number or the
  sharpest moat claim (curl + decoded sBTC JSON; "the only decoded sBTC peg feed on
  Stacks"). Most-seen surface; design for the share.
- **Collect 2-3 real testimonials** from Stacks teams before driving traffic
  (principle 29). Until then, provable usage counters are the proof.

**C — gated (sequence behind the data-plane build):**

- **Promote the named sBTC-peg endpoint to the hero announcement pill** ("New —
  decoded sBTC peg events, keyless →") ONLY once the M-effort peg SKU ships (see
  data-plane section). Until then frame the niche against existing `sbtc/events`
  ("the decoded events Hiro declined, #1709") — true today, no 404.
- **Elevate x402 from a Streams footnote to a named differentiator** — "the only
  data API on Stacks an agent can pay per call, no account, settled on Stacks"
  (principle 19, genuinely never-seen). Position as proof-of-edge, not a revenue
  pitch ($0 modeled); fix the hot-sponsor-key griefing exposure first (see P1-ish
  guardrail in data-plane section).

## Pricing & packaging — evolution plan

> ✅ **SUPERSEDED + SHIPPED 2026-06-13** by the usage-based model
> (`docs/internal/audits/usage-pricing-model-2026-06-13.md` + the rollout plan
> `docs/internal/sprints/usage-based-pricing-plan.md`). LIVE in prod: free = keyless reads of
> the recent 24h window (10 req/s) → **prepaid credits pay-as-you-go** ($5/1M rows, both Index +
> Streams) → **flat Pro repriced $99 → $79** → Enterprise. Trial gate (deploy/webhooks) + credits
> top-up UI + the Stripe $79 reprice all shipped. The "flat unmetered, predictability is the edge"
> stance below is OUTDATED — reads beyond the tip are now metered via opt-in prepaid credits
> (bill-shock handled by prepaid balance = hard cap, not a meter). STILL DEFERRED from this
> section: surface $299 Studio, reprice Enterprise to $3-8k. The pre-2026-06-13 text below is
> kept for history.
>
> Source: `docs/audits/pricing-model-indexer-audit-2026-06-12.md` + founder review
> 2026-06-13. Tiers stay **Free / Pro $99 / Enterprise**; what changes is what each tier
> *contains*, plus one surfaced middle rung. Price points are the only locked part.

**Metering stance (settled).** Base reads stay FLAT and unmetered — predictability is the
edge, and bill-shock kills design-partner deals (Tinybird + PlanetScale both retreated from
fine-grained meters in 2025). The "≥10 paying accounts" gate is about building AUTOMATED
Stripe metering, not about whether we capture usage now: heavy-tail overage is invoiced by
hand from SQL today. Keep it manual until automation is cheaper than the query. Capture
usage via opt-in SKUs (step 3), never read meters.

Ordered by leverage:

1. **Surface the $299 middle tier ("Studio").** Fixes the $99→$1.5k 15× cliff — most
   serious dapps are $299 customers currently paying $99 or nothing. Plan id `scale` +
   Stripe lookup keys already exist (`packages/platform/src/pricing.ts`); flip from "manual
   deals only" to public. Highest leverage, lowest effort. **[founder decision — touches the
   locked Free/Pro/Enterprise ladder]**
2. **Reprice Enterprise to value ($3–8k anchor), stop anchoring at $1.5k.** mempool.space
   charges $1,499–5,999 flat for the same dedicated/SLA/co-brand shape; a wallet or explorer
   that structurally depends on our data has the budget. See the anchor-candidate shortlist
   (research, 2026-06-13).
3. **Ship Phase-1 capacity caps + 1–2 opt-in usage SKUs.** Caps (subgraph slots 3/10,
   stored rows 250k/5M, concurrent SSE tails 2/10 for Free/Pro; first-party exempt
   allowlist already exists) give Free→Pro→Studio real upgrade pressure; SKUs
   (backfill-as-a-job, storage add-on, dedicated capacity) capture the heavy tail day-one
   without meters. Impl scope + file map in the audit. Effort: slots ~3h, recycle/SSE 2–4d
   each, stored-rows cap 4–5d (`measureStorage()` is dead code — needs a real job).
4. **x402 = value-tiered call option.** Wire per-route weights above the gas floor
   (read < aggregate < backfill); expect ~$0 until agent volume exists. Priced right for
   when it arrives; not modeled as a revenue line.
5. **Multichain = the real ceiling-raiser, gated behind the first anchor deal.** Being the
   only Bitcoin-L2 indexer is wasted on one L2; the same infra across the sBTC ecosystem +
   other Bitcoin L2s multiplies TAM while we stay the monopoly indexer. Sequence per the
   roadmap ruling: land the anchor first.

**Free-tier removal + price sequencing (viral-principles audit, 2026-06-13 — HIGH conf).**
Founder's lean to remove free is correct; the discipline is to remove the free *plan*
while preserving the free *try*. Three separable things the copy currently fuses:
*play* (keyless reads, no account — KEEP forever, it's the wedge), *free* (self-host,
MIT — that IS the free tier), *paid* (a provisioned hosted tenant — deploy/webhooks/
backfills on our infra). The free authenticated plan is the exact offer self-host already
gives away, buys zero read headroom over keyless (both 100 req/s), and converts <3%.

- **Drop the "$0 · Free forever" card** from `pricing/page.tsx`; split `FREE_INCLUDES`
  into a "free to try, no account" strip (keyless reads, ghost keys, dumps, MCP) vs the
  paid hosted product (private subgraphs, webhooks). Effort: **S**.
- **Replace the perpetual free tenant with a card-on-file expiring trial** (14d) so the
  Subgraphs deploy-aha still happens, then converts or ends (hard paywall at first paid
  action, principle 8). **Conditions before flipping:** (C1) Stripe billing LIVE not
  test-mode + deploy-private→card-pull round-trips; (C2) trial wired; (C3) Explore/
  first-party seeds on the `genesisExemptAccountIds` allowlist so fork-and-deploy survives.
- **Surface $299 Studio publicly NOW** (dup of item 1 above — zero-build config flip,
  `plan id 'scale'` + lookup keys exist) and **anchor it as the middle "most teams pick
  this"** to break the 15× $99→Enterprise cliff. Reprice Enterprise to a real "$3-8k,
  talk to us" card (item 2).
- **Do NOT hike Pro $99→$149 yet.** Premium price for "page it in prod / SLA" language is
  selling a promise the infra can't keep (single node/decoder/listener, no replica). Gate
  the headline hike + SLA copy behind the SLA-redundancy build actually shipping (see
  data-plane section). Raise the floor now (Studio + Enterprise, no infra risk); raise the
  headline the day you can sign an SLA.
- **Add a one-time Backfill-as-a-Job SKU** (~$299, no subscription, principle 27 escape
  hatch) — low-friction wedge for teams allergic to monthly; monetizes the genesis-backfill
  capability now buried as a Pro bullet. **Surface the annual prepay toggle** (2-months-free
  already in `pricing.ts`).
- **Lead cards with outcomes, footnote the caps.** "Ship this week" / "run it in prod" /
  "the decoded sBTC feed Hiro declined" — not "headroom/capacity" (principle 24).

## Data-plane / anchor wedge

> Source: `docs/internal/audits/data-plane-wedge-2026-06-13.md` (ultracode workflow +
> founder anchor research). Thesis: be the **decoded-semantics data plane** for the data
> Stacks Labs/Hiro declined to build — decoded **sBTC peg events**, **PoX-cycle** semantics,
> and decoded Clarity calls the analytics stack can't ingest — positioned as the maintained
> successor to Hiro's archived Chainhook. NOT "run the Hiro API without a node" (that fails
> until balances + call-read ship). Honest MRR: $6-9k credible 12mo, $18-22k if the SLA build
> ships + ≥2/3 anchors convert, $30k+ is a 24-36mo target. Binding constraint = 2-person
> throughput, not features. Sequence in this order:
>
> **1 (now, S)** webhook signing fix [see P1] → **2 (M)** peg + PoX SKUs → **3 (the real
> quarter)** SLA redundancy → **4 (M)** $299 Studio public + caps → **5 (L)** wallet read
> surface → **6 (on pull)** Dune/QuickNode/tenancy.

**Anchor / GTM framing (founder rulings 2026-06-13).** Model ONLY recurring revenue as MRR;
grants = runway, not MRR. $30k MRR is recurring — don't let a one-time $50k grant masquerade as
a revenue line.

- **Stacks Foundation / Stacks Labs — grant first, recurring later (two tracks, model only one).**
  *Track A (bankable now):* a Foundation **grant** funding the decoded sBTC-peg/PoX dataset as a
  **public good** (open parquet dumps + sponsored grantee access), mapped to their named 2026
  "Agentic readability" line — we already shipped the x402 + MCP agent rail they lack. One-time,
  ≤$50k, **Signal21 precedent** ("Foundation is first customer" of a Foundation-funded for-profit
  data co). Resolves the for-profit/grant tension: the grant funds the *public good*, our hosted/
  SLA tier is the *sustainability* mechanism so they fund ONCE; the MIT self-host path makes it
  vendor-neutral (kills the "won't anoint one vendor" objection). This is the
  "free if you self-host, paid if we host it" line (viral-positioning section) pointed at the
  Foundation. *Track B (aspirational — DON'T model as MRR):* a recurring data-plane agreement with
  **Stacks Labs** (the ~$27M-budget operational entity, a separate pocket from Foundation grants),
  only once a decoded surface is actually load-bearing inside their API. **Open Q to settle in the
  actual conversation:** does Stacks Labs have independent OPEX (→ recurring anchor) or is its
  money Foundation-grant-routed (→ one-time bounty)? Until they wire our feed into something they
  ship, count it as a grant. Recurring anchors that DO count as MRR: Zest, a Dune license, and
  wallet/custody Enterprise.

- **Productize decoded sBTC peg-in/peg-out** — the single sharpest moat: Hiro declined it
  (stacks-blockchain-api #1709 "not planned"), only Emily (bridge-operator-run) has it.
  **Substrate already decoded (~80% — verified):** `sbtc-storage.ts` row carries topics
  `completed-deposit / withdrawal-create / withdrawal-accept / withdrawal-reject / key-rotation`
  plus the correlation keys `request_id`, `bitcoin_txid`, `sweep_txid`, `recipient_btc_*`,
  `amount`, `signer_*`.

  **Product surface =** the keyless `/v1/index/sbtc/*` read API + named webhook topics + the
  Peg Explorer proof artifact. **Definition of done =** the only productized decoded sBTC peg
  feed on Stacks — curl-able with no key, signed, reorg-correct — that a wallet/Zest/Foundation
  can integrate against; webhooks fire on lifecycle transitions; a public Explorer renders it.

  **SHIPPED 2026-06-13 — read + lifecycle SKU** (`fbb42c96`+`1481f1ec`; api is private):
  (a) lifecycle state machine joining rows by `request_id` (withdrawal
  `REQUESTED→ACCEPTED|REJECTED`; deposit single-event `COMPLETED`); (b) typed endpoints —
  `/v1/index/sbtc/events` (raw, all topics incl. signer/governance), `/sbtc/deposits`,
  `/sbtc/withdrawals` (rolled-up one row per request_id), `/sbtc/withdrawals/:request_id` (full
  assembled lifecycle), `/sbtc/deposits/:bitcoin_txid` — all with the cursor+tip+reorgs envelope,
  OpenAPI entries, unit + route tests; (d) confirmed-finality gating (`?confirmed=true` clamps
  `to_height` to `finalized_height`). The withdrawal lifecycle already exposes a
  `settlement.{sweep_txid, btc_confirmations:null, settlement_confirmed:null}` placeholder the BTC
  confirmer fills. File: `packages/api/src/index/sbtc-peg.ts`.

  **REMAINING for "done":** (c) ~~named webhook topics~~ **SHIPPED 2026-06-14** —
  `sbtc_deposit` / `sbtc_withdrawal_create` / `sbtc_withdrawal_accept` / `sbtc_withdrawal_reject`
  `ChainTrigger` types + `emitSbtcOutbox` evaluator path (`shared@6.34.0` / `subgraphs@3.15.0`);
  (e) ~~**aggregates** `/v1/index/sbtc/summary`~~ **SHIPPED** — net peg flow, total locked
  sats, sBTC supply, counts over `sbtc_events` / `sbtc_token_events` (`sbtc-peg.ts:933`,
  route `routes/index.ts:777`). (The BTC L1
  settlement confirmer that fills the settlement placeholder + emits
  `sbtc.withdrawal.swept.confirmed` is the separate bullet below.)

  **Reference-implementation shelf (build ON the now-live feed — proof artifacts + dogfood):**
  - **(1) sBTC Peg Explorer** *(flagship — THE reference implementation for the SKU; public, in
    Explore)* — "Etherscan for the sBTC bridge": live deposits/withdrawals with lifecycle status,
    BTC↔Stacks tx correlation, time-to-settle, net-flow charts, **built only on the keyless
    `/v1/index/sbtc/*` API** (the feed now exists). **Done =** a public page (`/sbtc` or an Explore
    entry) consuming the feed with no key, linked from the data-plane pitch — the single best proof
    artifact for Zest, the Foundation "Agentic readability" grant ("here's the public good, live"),
    and the wallets. Doubles as the canonical reference dataset. Effort: **S-M** (frontend on the
    live feed).
  - **(2) Wallet deposit-status widget** — drop-in SDK example ("track your BTC→sBTC deposit",
    webhook → status UI). The wallet-wedge demo (Xverse/Leather/Ryder).
  - **(3) Peg reconciliation / supply-health dashboard** — net BTC locked vs sBTC supply over
    time, **reconciled against Emily**. Earns its keep twice: marketing public good AND literally
    the correctness cross-check #1 below (Emily reconciliation). Frame as peg-health, NOT
    CeFi proof-of-reserves.
  - **(4) DeFi "settled-collateral guard"** — tiny example crediting sBTC collateral only after
    peg-in confirmed-finality; demos the Zest/Granite liquidation primitive in a safety-critical
    flow.
  - **(5) Peg-out alert agent** — webhook/x402-driven bot firing on large or stuck peg-outs;
    demos Subscriptions + x402 together (the agent-native story).

- **BTC L1 settlement confirmer for sBTC withdrawals (scoped — on-moat only).** Withdrawals are
  the one place the Stacks event isn't enough: `withdrawal-accept` carries `sweep_txid` (the BTC
  tx the signers committed to broadcast), but the Stacks side does NOT prove the sweep CONFIRMED
  on Bitcoin — there's a broadcast→confirmed (rarely dropped/RBF) window where "accepted" ≠ "BTC
  received". Deposits need NO check (`completed-deposit` fires only after signers see BTC confs).
  Build a thin reader that confirms `sweep_txid` against **our own bitcoind** (node-server,
  RPC :8332 — today sealed as the stacks-node burnchain backend; not touched by the indexer) via
  `getrawtransaction <txid> true`, adds `btc_confirmations` + `settlement_confirmed` to the
  withdrawal lifecycle, and emits `sbtc.withdrawal.swept.confirmed` at N confs. Own-node is
  authoritative + on-brand vs the mempool.space fallback in `packages/stacks/tools/btc`.
  **Infra:** expose bitcoind RPC to the indexer over the same private link the stacks-node RPC
  already uses (or run the confirmer on node-server, writing to the DB). **Discipline guardrail:**
  surface Bitcoin L1 data ONLY for sBTC peg settlement — do NOT drift into general BTC
  balances/UTXO/ordinals indexing (different engine, saturated, Xverse incumbent — see the
  chain-expansion audit). The full BTC node is an asset for settlement finality, not a license to
  become a Bitcoin API. Effort: **M**. Files: `packages/indexer/src/decode/` (new btc-confirmer),
  `docker/node-server/` (RPC exposure).

- ~~**Productize PoX-cycle / reward-set aggregate endpoints**~~ **SHIPPED 2026-06-14** —
  `/v1/index/pox/cycles` (paginated, `limit`/`cursor`) + `/v1/index/pox/cycles/:reward_cycle`;
  fields: `total_stacked_ustx`, `unique_stackers`, `unique_delegators`, `action_count`,
  `start/end_block_height`, `is_current`, `function_breakdown`. Cache 30s current / 3600s
  completed. File: `packages/api/src/index/pox-cycles.ts`.

- **SLA-enabling redundancy (scope as 3-4 builds, not one).** SLA-criticality is the only
  validated true-anchor lever; the two biggest revenue lines (Zest, Dune) need a *signable*
  SLA. Sub-builds: (a) hot-spare stacks-node with reorg-consistent cutover; (b) Postgres
  streaming replica/standby with a defined RPO; (c) indexer leader-failover (today a single
  NOTIFY listener, no replica); (d) published RTO/RPO + status page + incident runbook.
  ~a quarter of work for 1-2 people; every top-MRR line is gated behind it. Effort: **L×3-4**.
  Files: `docker/docker-compose.hetzner.yml`, `docker/Caddyfile`, `docker/scripts/deploy.sh`,
  `docs/incidents/INCIDENTS.md`.

- **Second source of chain truth — CORRECTNESS, distinct from the availability SLA above.**
  Peg/PoX/reorg webhooks all derive from ONE node → ONE decoder; a silent decoder bug or node
  fork ships CONFIDENTLY WRONG settlement-status to a custody/lending partner — worse than
  downtime (downtime they detect and pause on; wrong data they act on). Cheap-first ladder, NOT a
  duplicate stack on day one:
  - **(1) Reconcile peg events against Emily** (bridge-operator's own tracker — already exists) →
    alarm + **hold-publish on divergence**. 20%-effort / 80%-value; covers the sharpest moat.
  - **(2) Canary canonical block-hashes against one external RPC** (Hiro/QuickNode). We already
    serve hashes (`canonical.ts`); the missing piece is the external compare + alarm.
  - **(3) Later only:** a full second stacks-node as a true independent decode path.

  Principle: cross-check our output against something we don't control, and refuse to publish on
  divergence. Pairs with the SLA-redundancy item but is a separate *correctness* guarantee (that
  item is *availability*). Effort: **S-M** for (1)+(2).

- **JWKS-style multi-key endpoint + key-rotation overlap window.** One static signing key is
  shared across Streams + webhooks, hot in 3 env surfaces, with no rotation runbook — a leak
  means coordinated simultaneous rotation for every pinned partner (a security incident, not a
  nice-to-have). Serious integrations (Xverse, Asigna, Dune) expect JWKS. Effort: **M**.
  Files: `packages/api/src/streams/signing.ts`, `packages/api/src/routes/status.ts`.

- **Sign Index live reads (full build — demand-gated).** *Context: Streams live reads are
  already ed25519-signed and the SDK now verifies by default (lenient); Index REST reads carry
  NO response signature.* To extend the signed-attestation story to Index: add a server signing
  path (mirror `respondSignedJson` from `streams/signing.ts`) so `/v1/index/*` responses carry
  `X-Signature` + `X-Signature-KeyId`, then add the SDK verify path to the Index client
  (`packages/sdk/src/index-api/client.ts` — today has none) reusing the streams key-fetch/rotation
  logic. **Why deferred:** for a generic app dev hitting a live read, the signature adds ~nothing
  over TLS — almost nobody verifies live reads. The real value is a *portable, non-repudiable
  attestation* for a **custody / sBTC-peg "second source of truth" buyer** (the data-plane wedge)
  who needs to prove to a third party "Secondlayer asserted this row." Build it for the first such
  named buyer, not speculatively (demand-before-supply). Until then the doc scoping is honest:
  Index reads are explicitly *not* signed yet. Pairs with the correctness-canary + JWKS items.
  Effort: **M**. Files: `packages/api/src/index/*` (response signing), `packages/sdk/src/index-api`.

- **Account/address read surface** — STX/FT balances, NFT/FT holdings, nonces, `stx_inbound`.
  Verified absent (no `/balances` route in `routes/index.ts`; decoded EVENTS only). The
  number-one wallet dependency — Xverse/Ryder/D'CENT/Leather can't cut Hiro without it, and the
  honest "without-a-node" claim depends on it. Large; do NOT front-load before the moat + SLA.
  Effort: **L**. Files: `packages/api/src/index/` (new address module),
  `packages/shared/src/db/source-read-columns.ts`, `packages/sdk/src/index-api`.

- **Co-built liquidation / health-factor SLA webhook primitive (Zest = first customer).**
  ~80% existing primitive + 20% Zest-specific decode — NOT a from-scratch service. Three layers:
  (1) **position-tracking subgraph** over Zest v2 contracts — `defineSubgraph` decoding
  borrow/repay/collateral events → a positions table with a computed health factor (the
  Zest-specific 20%; the data isn't the moat, so this layer can be PUBLIC in Explore as social
  proof); (2) **confirmed-finality threshold trigger** on that table firing a **signed webhook**
  when a position crosses liquidation — the existing 80%, built on `trigger-evaluator.ts` +
  Subscriptions; (3) optional **x402-metered read endpoints** for their keeper bots. Build layer 2
  as a PORTABLE "collateral-breach" template (Granite/Velar adopt via config, not a rewrite) —
  that de-risks the Zest concentration (60-79% of Stacks DeFi TVL): the sunk build becomes a
  lending-liquidation PRODUCT that Zest is merely customer #1 of, surviving Zest churn.
  **Ask to Zest:** a paid pilot — setup/integration fee + monthly SLA retainer — to run their
  liquidation monitoring as the maintained successor to the self-hosted Chainhook they're already
  trying to shed (Hiro archived it Feb 2026). Effort: **M**.
  Files: `packages/subgraphs/src/runtime/trigger-evaluator.ts`,
  `packages/shared/src/schemas/subscriptions.ts`.

  **Product surface =** a PORTABLE "collateral-breach" webhook product (not an `if(zest)` script).
  **Reference implementation =** the public Zest-v2 position-tracking subgraph in Explore (the
  data isn't the moat, so it ships as social proof). **Definition of done =** (1) that subgraph
  live in Explore computing per-position health factors; (2) a confirmed-finality threshold trigger
  firing a *signed* webhook when a position crosses liquidation, configurable so Granite/Velar adopt
  it without a rewrite; (3) optional x402-metered reads for keeper bots — and Zest running their
  liquidation monitoring on it under a signed paid pilot. The portability is the de-risk: the sunk
  build becomes a lending-liquidation PRODUCT Zest is merely customer #1 of, surviving Zest churn.

- **x402 sponsor-spend guardrails.** Gas paid from a hot sponsor key (~200 STX) is an unbounded
  outflow / griefing surface at agent scale — add per-caller spend caps + a sponsor-balance
  circuit-breaker before x402 volume arrives. Liability, not pure upside. Effort: **S-M**.

- **Read-only Clarity call proxy + contract source on the index plane** (`/v2/contracts/call-read`,
  not the OSS-only `node.ts` proxy). 2nd most-hit Hiro endpoint class after balances; powers
  Fordefi pre-sign simulation + wallet contract reads. Effort: **M**. On named pull.

- **Wholesale `stacks.decoded.*` tableset + dbt connector** (contract_calls, events, sbtc_peg,
  pox_cycles) parquet→S3 for a Dune add-a-chain license, + a QuickNode 70/30 marketplace add-on.
  Sell once, the channel carries CAC. Build on named pull (Dune/QuickNode). Effort: **M**.
  Files: `packages/indexer/src/streams-bulk/exporter.ts`, `packages/shared/src/streams-bulk/schema.ts`.

- **Data-plane positioning surface on the site.** The Kourier/Stacks-Labs/wallet/Foundation
  infra narrative is invisible (grep of `apps/web` for hiro/stacks-labs/leather/xverse/partner
  returns nothing) — funded prospects have no page to self-qualify and outbound has no landing
  asset. New `/data-plane` route. Effort: **S**.

- **Partner/tenancy provisioning + per-tenant metering (Phase 4, on named pull ONLY).** Revive
  the dormant `tenants` table (`/api/tenants` in PLATFORM_PATHS, no router mounts;
  `projects.ts:297` returns `DEDICATED_PROVISIONING_DISABLED`; `usage_daily.tenant_id` always
  NULL) into a callable admin/provisioning API for the Dune/QuickNode channel or Stacks Labs
  sponsored access. Build ONLY on a named channel deal. Effort: **L**.

## P1 — correctness, do next

- ~~**Webhook ed25519 signature is a silent no-op in prod.**~~ **SHIPPED** (`d9b5d342`) —
  `STREAMS_SIGNING_PRIVATE_KEY` wired into `subscription-processor` compose env; boot-time
  `assertWebhookSigningConfigured()` fails loud on missing key.

- ~~**Trial enforcement: copy promises a paywall the product doesn't enforce.**~~ **SHIPPED**
  (`ffc2c0ed`) — `trial_period_days: 14`; `resolveDeployPolicy` gates public deploys behind
  trial/plan; `SUBSCRIPTION_QUOTA_BY_PLAN.none = 0` (webhooks require trial);
  `genesisExemptAccountIds` allowlist preserves Explore seeds.

- **Per-plan subgraph slot caps — subgraphs can't be unlimited.** A trial/Pro account can
  deploy infinitely many subgraphs (each = real index + storage + compute cost), and public ones
  pile onto Explore. Need a per-account slot quota by plan, enforced at CREATE (not redeploy),
  mirroring `SUBSCRIPTION_QUOTA_BY_PLAN` — a new `SUBGRAPH_SLOT_QUOTA_BY_PLAN` inside
  `resolveDeployPolicy`, with `genesisExemptAccountIds` exempt (Explore seeds). **Open: per-plan
  numbers are a founder pricing call** (tiers are now Trial / Pro $79 / Scale $299 / Enterprise;
  no persistent free plan) + whether public & private both count against the same cap. Effort:
  **S** once numbers are set. Files: `packages/api/src/subgraphs/plan-limits.ts`,
  `routes/subgraphs.ts`.

## P2 — should do

- **x402 Phase 3 smoke ladder S2–S7.** Rail is live + S1 (per-call optimistic read)
  verified end-to-end in prod 2026-06-12. Remaining steps exercise the other paths — run
  with the W4 test payer (`SP39Z29Z…`, ~20 STX) via `scripts/x402-mainnet-smoke.ts`; full
  plan in `docs/sprints/x402-activation-kickoff.md`:
  - **S2 Session** — one paid call mints a `PAYMENT-SESSION` voucher; replay rides free
    until budget/TTL (streams: 500 calls/1h); confirm the Redis session counter. (~$0.001)
  - **S3 Token matrix** — repeat the paid read with **sBTC** and **USDCx** (not just STX) to
    prove spot-priced multi-asset settle. **BLOCKED**: W4 holds STX only → fund ~$5 sBTC +
    ~$5 USDCx, or skip.
  - **S4 Deposit + drawdown** — `POST /v1/x402/deposit` (confirmed-tier, ~$1) → prepaid
    balance token → read debits via `PAYMENT-BALANCE` (no on-chain round trip),
    `X-BALANCE-REMAINING-USD` decrements, `GET /v1/x402/balance` matches. **The high-volume
    indexer mode** (deposit once → many near-instant debited calls); highest-value next.
  - **S5 Paid deploy** — deploy a tiny subgraph via x402 ($2, confirmed) → wallet-ghost
    account (expires +7d, forward-only) → reads work → renew ($0.50) extends → `POST
    /api/wallet/link` adopts the ghost into a real account (continuity E2E). (~$2.50)
  - **S6 Guards under fire** — velocity downgrade to confirmed-tier after 120/min, replayed
    nonce rejected, malformed `PAYMENT-SIGNATURE` → 402 (not 500), deposit < $0.25 → 422.
  - **S7 Ledger audit** — every settle in `x402_payments` with correct kind/state/payer, no
    orphans, W2 treasury received the sums, W1 sponsor gas spend ≈ expected.

  Budget: W4's 20 STX ≈ $3.58, so S4 ($1) + S5 ($2.50) just fit on STX alone; only S3 needs
  the other tokens funded.

- **Dump history back to chain genesis.** Streams parquet dumps cover blocks
  ~7,810,000–8,259,999 only (42 windows; the dump program started 2026-06-03).
  `replay({ from: "genesis" })` now spans all 42 (cumulative `latest.json` shipped),
  but that's "earliest available dump," not chain block 1. To make genesis literal,
  backfill windows 1–7.81M from the source DB (re-export ~780 windows; confirm source
  retains that range first). Until then docs say "earliest available dump."
  Ref: `packages/indexer/src/streams-bulk/exporter.ts`, `rebuild-latest-manifest.ts`.

- **tsc tech debt: `ctx.increment` API drift.** 13 type errors, pre-existing, unrelated
  to recent work: `scripts/seed-balances/{sbtc,alex,usdcx}-balances.ts` and
  `packages/api/test/handler-replay-safety.test.ts` call `ctx.increment(...)` with a
  string where the type now wants `"update" | "patchOrInsert" | "increment"`. Either
  update the callers to the current subgraph ctx API or delete the dead seed scripts.

- **`secondlayer-api` skill is stale.** `SKILL.md` calls Streams "pre-alpha,
  internal-only"; Streams is prod-live with public dumps + an x402 read rail. Agents
  entering via the skill will anti-recommend a shipped product. Out of scope during the
  positioning arc by founder call; fix on next skill touch.

- **Subgraph deploy silently ignores the definition's `version`.** Deploy auto-increments
  its own patch counter (file declared `1.1.0`, platform deployed `1.0.1`). The
  auto-versioning default is wanted — keep it — but an explicit `version` in the definition
  should override it, and warn + fail if that exact version is already deployed (no silent
  clobber). Surfaced 2026-06-20 deploying `sbtc-flows`. Ref deploy path
  `packages/cli/src/commands/subgraphs.ts`.

## P3 — nice to have / pending a decision

- **Replace the BYO replay-safety heuristic with a real AST / runtime guard.**
  *Context: `handler-replay-safety.ts` now uses a broadened regex set that catches the
  common defeats — method-alias (`const u = ctx.update`), destructure (`const {update} = ctx`),
  bracket (`ctx["update"]`), optional-chain (`ctx?.update`) — parser-free.* Residual gaps a
  regex can't close safely: aliasing the **context object** itself (`const c = ctx; c.update()`)
  and computed keys (`ctx[name]`). A full fix is either (a) an AST/data-flow pass (parse the
  handler with the TS compiler API — already a dep — and track `ctx` references through scope),
  or (b) a **runtime guard** that wraps `ctx` so the delta methods (`update`/`patchOrInsert`/
  `increment`) throw during a replay window (parser-free, bulletproof, but a behavior change).
  **Why deferred:** BYO is a *frozen periphery* surface (STRATEGY: zero further investment); the
  corruption is *self-inflicted into the customer's own DB*; and the remaining defeats require
  *deliberately* aliasing past a visible guard. Over-investment until BYO unfreezes on a named
  request. Effort: **M** (AST) / **S-M** (runtime wrap). Files:
  `packages/api/src/subgraphs/handler-replay-safety.ts`, `packages/subgraphs/src/runtime/context.ts`.

- **`SUBGRAPH_HEAVY_OP_BUDGET` tuning (env, no deploy).** Heavy (genesis-scale) subgraph
  reindexes are capped at 2 in flight to protect the target plane; fresh genesis deploys
  queue behind in-flight reindexes by design. Raising the budget speeds fresh deploys at
  the cost of target-plane write contention. Left at **2** (founder, 2026-06-13). Revisit
  if fresh-deploy latency becomes a prospect-facing problem.
  Ref: `packages/shared/src/db/queries/subgraph-operations.ts` (claim budget),
  prod env on `secondlayer-subgraph-processor-1`.

- **`sl index sync` scaffold.** One command to emit a mirror schema + walk loop +
  checkpoint table for Index (turns the parts kit into a 1-command start). Deferred
  behind the CLI local-dev freeze; `sl index codegen` already covers the schema half.

- **Credits billing architecture review + TX sales-tax flag (logged 2026-06-14).**
  *Verdict: keep the current design — own-ledger prepaid, not Stripe metered.* Why it's
  right for us: (1) credits fund **two ways** — card (Stripe) + x402 crypto wallet — and
  only a self-owned `account_credits` ledger unifies them into one balance; Stripe-native
  credits can't absorb a crypto top-up. (2) **Sub-cent metering precision** — we debit per
  row in USD-micros ($5/1M rows); Stripe meters are coarser and add ingestion latency, our
  atomic SQL debit is exact + synchronous. (3) **Hard prepaid cap, no overdraft** —
  `balance >= cost` atomic debit = clean bill-shock ceiling, awkward to guarantee through
  Stripe metering. So Stripe stays the card-charge rail; consumption lives in our DB. The
  alternative (Stripe Billing Credits + meters) would couple us to metering we deliberately
  avoid, lose the crypto unification, and lose micro-precision — wrong fit.

  **The one real tradeoff** of the current inline `price_data` + `product_data` top-up
  (`packages/api/src/routes/billing.ts` `/topup`): no catalog Product, so Stripe's product
  analytics won't roll up "credits revenue" and there's no stable tax code on the line item
  (you can filter by the `kind: credits_topup` metadata, but it's manual).

  **Optional refinement (not a rearchitecture):** create one catalog Product `Secondlayer
  Usage Credits` and reference it with a still-dynamic price —
  `price_data: { currency: "usd", unit_amount: usd*100, product: CREDITS_PRODUCT_ID }`
  instead of `product_data: { name: ... }`. Keeps amount flexibility, adds clean revenue
  rollup + a consistent tax code. Costs one more catalog object; worth it only if we want
  Stripe-native credit revenue reporting or need a fixed tax code.

  **TX sales-tax flag (the actual reason to revisit — tax-advisor question, not code).**
  We're a TX entity; Texas taxes SaaS / data-processing services (80% taxable). Prepaid
  usage credits for a data API *may* be taxable on sale or on consumption depending on
  characterization. **Revisit when:** confirming with a tax advisor before/around the live
  Stripe flip. **If we owe sales tax:** do the refinement above (real Credits Product w/
  proper tax code) + enable **Stripe Tax** — makes compliance much easier than ad-hoc line
  items. Until a tax advisor says otherwise, leave the architecture as-is. Effort: **S**
  (refinement) once decided. Files: `packages/api/src/routes/billing.ts`,
  `packages/api/scripts/stripe-setup.ts`.

## P4 — watch / cleanup

- **`latest.json` size ceiling.** The cumulative dump manifest grows ~1 file entry per
  10k blocks (~250KB at 42 windows). Fine for years; if it crosses ~a few MB, paginate or
  add an index manifest the SDK walks.

- **`gamma-sales` demo subgraph.** Deployed public as the docs graduation example; its
  genesis reindex drains behind the heavy-op budget. Decide whether it stays a permanent
  showcase or gets torn down after the docs ship.
