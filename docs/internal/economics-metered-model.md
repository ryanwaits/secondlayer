# Metered hosted model (economics)

Status: DRAFT, numbers resolved (founder thread 2026-09-11). Internal.
Public copy must not ship until STRATEGY.md matches. Companion to
STRATEGY.md Pricing and PRODUCT.md "Open" hosted-SKU items.

**Superseded in part 2026-09-23:** hosted subgraphs and hosted webhook
delivery are not offered. Accountless play, claim, the $10 grant, and the
subgraph running/storage/indexing and delivery meters were removed
(anonymous handler code ran in-process beside prod credentials). Subgraphs
and webhooks are self-host only. The archive and Index/Streams read meters
below stand.

## Constraint

No monthly SKUs. One prepaid balance, dollars, across archive bootstrap
and hosted Index/Streams reads.
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

Subgraphs and webhooks are self-host only and unmetered.

## Proposed meters

All debit the same `account_credits` balance. Display unit is **dollars**,
not a credit token. Internally we already store micros; do not invent a
second denomination.

| Meter | Price | What it pays for | Notes |
|---|---|---|---|
| Archive partition | $0.05 / $0.15 (events) | R2 fetch | unchanged |
| Row read (Index, Streams) | $5/1M, $2/1M over $50/mo | query serving | |

## Resolved numbers (founder, 2026-09-11)

1. ~~Play grant = $10.~~ Removed 2026-09-23 with hosted subgraphs.
2. ~~No $250 usage gate.~~ Moot: no claim path.
3. **No Streams retention ladder.** 1-day hot window for everyone
   (already built). Older is free dump replay.
4. ~~Accountless play, account at claim.~~ Shipped 2026-09-11, removed
   2026-09-23 (migration 0135 drops claim_tokens, play_provisions,
   hosted_meter_days).
5. **Display = dollars everywhere.** No credit-token denomination.
   Quotes and balances print as `$`.

## Capacity at $10k/mo

- $10k/mo in row reads at $5/1M = 2B rows/mo ≈ 770 rows/sec. Trivial
  for this Postgres.
- Break-even: $400 ÷ $50 avg spend ≈ 8 customers.
- $10k/mo ≈ 50 teams at $200 avg, or 20 heavy ones at $500.
- GTM universe is ~30–80 funded Stacks teams (STRATEGY.md). Hitting
  $10k/mo means roughly full penetration of that universe, or growth
  past it. Worth saying out loud.

## STRATEGY.md consequences

Applied 2026-09-23: STRATEGY.md says hosted subgraphs and webhooks are not
offered; subgraphs and webhooks are self-host only. "Not a monthly
service" and "no Pro SKU" stand. Self-host stays unmetered.

## Out of scope here

Landing-page visual world, product switcher, and copy. Separate design
session. This file is the economic contract that session cites.
The homepage should surface Subgraphs and Webhooks (self-host),
Index/Streams, and archive — but that is layout/copy, not pricing.
