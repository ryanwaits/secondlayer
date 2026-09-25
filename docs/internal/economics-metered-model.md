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

**Updated 2026-09-24 (one ledger):** every meter now runs through
`usage_ledger` + `meter()`, one price table, and a 10M-rows/month
allowance replacing the free-height window and the Streams retention
ladder — both dropped.

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

## What exists (plan-049, one ledger)

Credits are USD-micros (`account_credits.balance_usd_micros`). 1 USD =
1,000,000 µ$. `meter()` (`packages/platform/src/billing/meter.ts`) is the
one function that debits it; `usage_ledger` is the append-only record of
every charge. Prices live in one table, `packages/platform/src/billing/prices.ts`:

| Unit | Price | Status |
|---|---|---|
| `archive.partition` | $0.05 | live |
| `archive.partition.events` | $0.15 | live |
| `rows.delivered` | $5/1M; $2/1M once monthly spend ≥ $50; first 10M rows/mo free | live |
| `memory.gb_hour` | ~$0.028/GB-hour | priced, no caller yet (044) |
| `storage.gb_day` | ~$0.25/GB-month billed daily | priced, no caller yet (046) |
| `webhook.event` | $10/1M, retries free | priced, no caller yet (044) |

- The first 10M `rows.delivered` per account per UTC calendar month are free
  — replaces the old free-height window and Streams' 1-day retention
  ladder (both removed). An account still under the allowance, or with
  balance ≥ `MIN_CREDITED_USD_MICROS` (one page's worth), reads full
  history and pays per row past the allowance. Once the allowance is used
  up and the balance is short, the credits gate refuses the read up front
  with 402 `insufficient_credits` + a top-up link — the pre-check that
  keeps an out-of-credits key from becoming an unmetered feed of all
  history (`index/credits-gate.ts`, `streams/credits-gate.ts`).
- Hosted `/v1` Index/Streams reads require an `sk-sl_*` key (401 without
  one) — the allowance is per account, so a keyless feed of all history
  would be unmetered.
- Free repair allowance (archive `repair` flow): 18 partitions/mo, a
  pre-check in `routes/archive.ts`, separate from the ledger allowance.
- Top-up packs: $10 / $25 / $50 / $100 (`routes/billing.ts`); a top-up
  writes a `unit: "topup"` ledger row with negative `usd_micros`.
- `POST /internal/meters`: batched ingest for the hosted-stack meters
  above, guarded by `WORKLOAD_HOST_KEY` (044/046's provisioner and
  gateway; no caller yet).
- `GET /api/billing/usage?month=`: per-unit quantity + cost from the
  ledger. No UI yet — the future consumer is the web account credits page.

Subgraphs and webhooks are self-host only and unmetered.

## Resolved numbers (founder, 2026-09-11; allowance 2026-09-24)

1. ~~Play grant = $10.~~ Removed 2026-09-23 with hosted subgraphs.
2. ~~No $250 usage gate.~~ Moot: no claim path.
3. **No Streams retention ladder.** Removed 2026-09-24 — the monthly
   allowance is the free tier now, not a time window; a read past it needs
   balance, or the credits gate 402s before serving it.
4. ~~Accountless play, account at claim.~~ Shipped 2026-09-11, removed
   2026-09-23 (migration 0135 drops claim_tokens, play_provisions,
   hosted_meter_days).
5. **Display = dollars everywhere.** No credit-token denomination.
   Quotes and balances print as `$`.
6. **A pipeline priced by rows delivered, not a query service** (founder
   2026-09-24). Tip and history cost the same; the archive is the only
   bulk discount.

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
