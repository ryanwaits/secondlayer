# Metered hosted model (economics)

Status: DRAFT, numbers resolved (founder thread 2026-09-11). Internal.
Public copy must not ship until STRATEGY.md matches. Companion to
STRATEGY.md Pricing and PRODUCT.md "Open" hosted-SKU items.

## Constraint

No monthly SKUs. One prepaid balance, dollars, across archive bootstrap,
hosted Index/Streams reads, hosted subgraphs, and hosted subscriptions.
Enterprise is a custom door, not a plan. Target: ~$10k/mo revenue at
~10 hr/week of operator work. Current infra bill ~$400/mo (mostly the
node server; mostly unused).

Self-host stays MIT and unmetered. This document is the hosted path only.

## Structural fact

COGS is ~100% fixed. Everything we sell rides hardware we already own.

| Cost center | Fixed | Marginal |
|---|---|---|
| AX52 app + AX162-S node + Storage Box | ~$400/mo | — |
| R2 archive (39 GB, 2026-08-12) | ~$0.59/mo, +0.7 GB/mo | $0.015/GB-mo storage, $0 egress |
| Hosted row read | — | PG CPU/IO on owned NVMe ≈ $0 |
| Subgraph sandbox | — | ~81.5 MB RAM per warm subprocess (measured, sandbox spike) |
| Webhook delivery | — | Hetzner dedicated traffic is unmetered ≈ $0 |

$400/mo ÷ $10k/mo target = 4% fixed-cost ratio. After Stripe (~3% + 30¢),
net margin at target is ~93%. We do not need plans because nothing we
sell has meaningful marginal cost. We need prices that (a) cover abuse,
(b) signal value, (c) cover $400 fast.

Do not optimize the $400 yet. Hetzner's June 2026 price adjustment hit
*new* orders (AX42-1 is €187/mo for new customers). Grandfathered pricing
is an asset. The AX162-S is the floor: bitcoind (~750 GB) + stacks
chainstate (~800–900 GB) needs ~2 TB of fast disk. Revisit only if
revenue stalls below $1k/mo for months.

## What already exists

Credits are USD-micros (`account_credits.balance_usd_micros`). 1 USD =
1,000,000 µ$. One balance already covers two meters:

| Unit | Price | Code |
|---|---|---|
| Archive partition (blocks / tx) | $0.05 | `packages/api/src/routes/archive.ts` |
| Archive partition (events) | $0.15 | same |
| Hosted Index / Streams row read | $5/1M; $2/1M once monthly spend ≥ $50 | `packages/api/src/lib/read-credits.ts` |
| Min PAYG balance | $0.005 (one 1,000-row page) | same |
| Top-up packs | $10 / $25 / $50 / $100 | `packages/api/src/routes/billing.ts` |
| Free repair allowance | 18 partitions/mo | archive.ts |
| Index free window | last 24h, 10/s | `index/free-window.ts`, `index/tiers.ts` |
| Streams free window | 1-day retention, 10/s | `streams/tiers.ts` |

Not metered today: subgraph deploys, subgraph table reads (despite
`mode.ts` claiming they are), subgraph storage, subgraph indexing,
subscription deliveries. Resource limits on hosted subgraphs are Docker
caps only (`routes/subgraphs.ts`). Five active hosted-production
subgraphs as of the sandbox spike.

Ghost-key claim plumbing (`claim_tokens`, anonymous `POST /v1/keys`)
was deleted in migration `0118_drop_retired_control_tables` / Gate G
Slice D. Play/claim is a rebuild inspired by that shape, not a revival
of live tables.

## Proposed meters

All debit the same `account_credits` balance. Display unit is **dollars**,
not a credit token. Internally we already store micros; do not invent a
second denomination.

| Meter | Price | What it pays for | Notes |
|---|---|---|---|
| Archive partition | $0.05 / $0.15 (events) | R2 fetch | unchanged |
| Row read (Index, Streams, **subgraph tables**) | $5/1M, $2/1M over $50/mo | query serving | subgraph table reads are a gap today — wire them into `debitCreditedRows` |
| Subgraph running | $3/mo, prorated daily | warm worker RAM (~81.5 MB, flat per subgraph) | paused = $0 (worker released). Table count does not change this fee |
| Subgraph storage | $0.50/GB-mo | tables + indexes + WAL backup share | captures N+1 table sprawl |
| Subgraph indexing | $1/1M blocks processed | trigger eval + handler CPU | full-history backfill ≈ $8.70, quotable upfront |
| Subscription delivery | $100/1M attempts | matcher + sender (not their endpoint) | retries metered; healthy endpoints cheaper |

CPU overage is not priced in dollars. A CPU-second on the owned Ryzen
is ~nothing. Heavy subgraphs cost *indexing latency for other tenants*,
which the scheduler already bounds (`SUBGRAPH_OPERATION_CONCURRENCY=8`,
`SUBGRAPH_HEAVY_OP_BUDGET=2`). Keep fairness in the scheduler, not the
price list.

Handler code already capped at 1 MB (`packages/shared/src/schemas/subgraphs.ts`).

## Play and claim

The play tier is the same code path as paid, with a $10 granted
balance instead of a topped-up one. No feature flags. Any schema, any
tables, any handlers, any subscription filter. Every meter ticks
against the grant. Grant exhausts → indexing/deliveries pause with a
claim prompt. 30-day unclaimed expiry reclaims disk and RAM.

Play is accountless: provision, get a claim URL. Max abuse damage =
$10 of near-zero-marginal-cost capacity. Query-side abuse is already
capped (anon 10/s). Sybil hole is spinning up infinite play sessions —
cap concurrent play subgraphs per IP/fingerprint (1–3). That is
anti-abuse plumbing, not a product limit.

Claim: create an account + first top-up ($10 min pack). Resources
transfer, they are fully theirs, hosted by us. Claim screen shows a
projected monthly cost from the play session's actual meters ("your
usage so far projects ~$X/mo").

Self-host remains the eject seat at any time. Same payload shapes on
hosted and self-host (PRODUCT.md).

## Resolved numbers (founder, 2026-09-11)

1. **Play grant = $10.** Matches the minimum Stripe pack. A small
   full-history backfill is ~$8.70; $5 would pause mid-backfill.
2. **No $250 usage gate.** Claim = create account + first top-up.
   The $10 min pack is the sybil cost.
3. **No Streams retention ladder.** 1-day hot window for everyone
   (already built). Older is free dump replay.
4. **Accountless play, account at claim.** Rebuild the claim-token
   shape (tables were dropped in migration 0118). Largest eng fork.
5. **Display = dollars everywhere.** No credit-token denomination.
   Quotes, balances, and the claim estimate all print as `$`.

## Capacity at $10k/mo

- $10k/mo in row reads at $5/1M = 2B rows/mo ≈ 770 rows/sec. Trivial
  for this Postgres.
- 50 claimed subgraphs ≈ 4 GB sandbox RAM of 57 GiB available.
- Break-even: $400 ÷ $50 avg spend ≈ 8 customers.
- $10k/mo ≈ 50 teams at $200 avg, or 20 heavy ones at $500.
- GTM universe is ~30–80 funded Stacks teams (STRATEGY.md). Hitting
  $10k/mo means roughly full penetration of that universe, or growth
  past it. Worth saying out loud.

## STRATEGY.md consequences (do not ship copy first)

Pricing section today: "Not a monthly service. We do not host
subgraphs. Monetization is archive bootstrap plus hosted Index/Streams
reads. No $99/mo Pro SKU."

Rewrite when this draft is approved:

- Keep "not a monthly service" and "no Pro SKU". That part is load-bearing.
- Drop "we do not host subgraphs". We host them, metered, same balance.
- Add hosted subscriptions (matcher + sender; they host the receiver)
  as a metered unit on the same balance.
- Keep self-host unmetered.
- Play/claim is the hosted onboarding path, not a plan ladder.
- Enterprise remains a custom door.

PRODUCT.md "Open" item on hosted SKUs closes against this file.

## Out of scope here

Landing-page visual world, product switcher, and copy. Separate design
session. This file is the economic contract that session cites.
The homepage should surface Subgraphs, Subscriptions, Index/Streams,
and archive — but that is layout/copy, not pricing.
