# Metered hosted model (economics)

Internal. The rationale behind STRATEGY.md Pricing. Prices live in
`packages/platform/src/billing/prices.ts`; if this file disagrees with that
table, the table wins.

Pricing is metered only and live. One prepaid balance in dollars pays for
archive bootstrap, hosted Index/Streams rows, and hosted per-account stacks
(subgraphs and webhook delivery). Every charge runs through `meter()` and
`usage_ledger`. There are no monthly tiers.

## Constraint

No monthly SKUs, no Pro SKU. One prepaid balance, dollars, across the archive
and every hosted meter. A running stack's floor is a minimum on the memory
meter, not a plan. Target: ~$10k/mo revenue at ~10 hr/week of operator work.
Current infra bill ~$885/mo excl. tax, ~$955 incl. 8% (Hetzner, September 2026
invoice, full-month run rate).

Self-host stays MIT and unmetered. This document is the hosted path only.

## Structural fact

COGS is ~100% fixed. Everything we sell rides hardware we already own.

| Cost center | Fixed | Marginal |
|---|---|---|
| node-server: AX162-S, legacy price | $272/mo | — |
| app-server: AX41-NVMe + 2×1 TB NVMe | $63/mo | — |
| stacks-feeder: CPX62 ($179) + 4 TB volume ($314), for the Stacks re-sync | $493/mo | — |
| Workload host: CPX32, runs hosted stacks | $49/mo | RAM and disk per stack |
| Storage Box BX11 + IPv4 addresses | $8/mo | — |
| R2 archive (39 GB, 2026-08-12) | ~$0.59/mo, +0.7 GB/mo | $0.015/GB-mo storage, $0 egress |
| Hosted row read | — | PG CPU/IO on owned NVMe ≈ $0 |
| Subgraph sandbox | — | ~81.5 MB RAM per warm subprocess (measured, `docs/internal/security/subgraph-processor-sandbox-spike.md`) |
| Webhook delivery | — | Bandwidth from the workload host (Hetzner Cloud); cost not measured |

$885/mo ÷ $10k/mo target ≈ 9% fixed-cost ratio. After Stripe (~3% + 30¢),
net margin at target is ~88%. We do not need plans because almost nothing we
sell has meaningful marginal cost. Hosted stacks are the exception: each holds
RAM and disk on the workload host, which the memory and storage meters and the
floor pay for. We need prices that (a) cover abuse, (b) signal value,
(c) cover $885 fast.

The feeder is the largest line and it is temporary: it retires after the Stacks
re-sync, taking the bill to ~$392/mo. A database server for the re-synced data
is an open founder decision (AX102-4 recommended, €757.30/mo when quoted in
October) and would add to that.

Do not optimize the rest yet. Hetzner's June 2026 price adjustment hit
*new* orders (AX42-1 is €187/mo for new customers). Grandfathered pricing
is an asset. The AX162-S is the floor: bitcoind (~750 GB) + Stacks
chainstate (~1.4 TB) needs over 2 TB of fast disk. Revisit only if
revenue stalls below $1k/mo for months.

## What's shipped

Credits are USD-micros (`account_credits.balance_usd_micros`). 1 USD =
1,000,000 µ$. `meter()` (`packages/platform/src/billing/meter.ts`) is the
one function that debits it; `usage_ledger` is the append-only record of
every charge. Prices live in one table, `packages/platform/src/billing/prices.ts`:

| Unit | Price | Charged by |
|---|---|---|
| `archive.partition` | $0.05 (`blocks`, `transactions`) | archive fetch gate |
| `archive.partition.events` | $0.15 (`events`, `state_writes`) | archive fetch gate |
| `rows.delivered` | $5/1M; $2/1M once monthly spend ≥ $50; first 1M rows/mo free | Index/Streams credits gates |
| `memory.gb_hour` | ~$0.028/GB-hour, floored at $5/mo webhook-only or $10/mo with subgraphs per running tenant | workload host memory sampler |
| `storage.gb_day` | ~$0.25/GB-month billed daily | workload host storage sampler |
| `webhook.event` | $10/1M, retries free | workload host event counter |

- The first 1M `rows.delivered` per account per UTC calendar month are free.
  An account still under the allowance, or with balance ≥
  `MIN_CREDITED_USD_MICROS` (one page's worth), reads full history and pays
  per row past the allowance. Once the allowance is used up and the balance is
  short, the credits gate refuses the read up front with 402
  `insufficient_credits` + a top-up link, the pre-check that keeps an
  out-of-credits key from becoming an unmetered feed of all history
  (`index/credits-gate.ts`, `streams/credits-gate.ts`). Past the allowance, a
  reached monthly spend cap refuses with 402 `spend_cap_reached`.
- Hosted subgraph indexing reads bill `rows.delivered` against the same
  allowance. The rows read to match webhook triggers do not.
- `memory.gb_hour` bills `max(sampled RAM, stackMemoryFloorGb(has_subgraphs))`
  per running tenant (`packages/workload/src/meters.ts`), so any running hosted
  stack floors at $5/mo (webhook-only, no `subgraph-processor`, ≈0.245 GB) or
  $10/mo (with subgraphs, ≈0.489 GB) even idling near 0. The floor is set in
  dollars (`STACK_FLOOR_USD_MICROS_PER_MONTH`); the GB floor is derived from it
  at the memory rate, so a rate change never moves the dollar floor. The
  workload control DB's `tenants.has_subgraphs`, reconciled from each tenant's
  subgraph count, picks which. Sampling only ever runs against
  `state = 'running'` tenants (`listRunningTenants`); a stopped tenant is
  never sampled, so it bills nothing.
- Hosted-stack units drain a short balance to 0 rather than refuse the charge.
  The provisioner's 5-minute poll (`POST /internal/accounts/credits`) stops a
  running tenant at zero balance or a reached spend cap, and restarts it once
  the account is ok again.
- Hosted `/v1` Index/Streams reads require an `sk-sl_*` key (401 without
  one): the allowance is per account, so a keyless feed of all history
  would be unmetered.
- Free repair allowance (archive `repair` flow): 24 partitions/mo (6 bundles ×
  4 datasets), a pre-check in `routes/archive.ts`, separate from the ledger
  allowance.
- Top-ups (`routes/billing.ts`): packs of $10 / $25 / $50 / $100, or any whole
  dollar amount from $5 to $1,000 when signed in, plus opt-in auto-refill. A
  top-up writes a `unit: "topup"` ledger row with negative `usd_micros`.
- `POST /internal/meters`: batched ingest for the hosted-stack meters above,
  guarded by `WORKLOAD_HOST_KEY`; the workload host is the caller.
- `GET /api/billing/usage?month=`: per-unit quantity + cost from the ledger,
  read by the web account pages.

Self-host subgraphs and webhooks are unmetered.

## Decisions (founder)

1. **No Streams retention ladder, no free-height window.** The monthly
   allowance is the free tier, not a time window; a read past it needs
   balance, or the credits gate 402s before serving it.
2. **Allowance = 1M rows/mo.** At 10M nearly every reader was free.
3. **Display = dollars everywhere.** No credit-token denomination.
   Quotes and balances print as `$`.
4. **A pipeline priced by rows delivered, not a query service.** Tip and
   history cost the same; the archive is the only bulk discount.
5. **No accountless hosted path.** Hosted subgraphs and webhooks run on an
   account key in a private stack. Anonymous handler code beside prod
   credentials does not come back.

## Sentinel (founder, 2026-09-29; billing split 2026-10-19)

Sentinel is a product on this platform with its own sign-in and console. It
shares identity with Secondlayer (account, sign-in, agent keys) and nothing
else about money: it bills on its own Stripe subscriptions in the shared
Stripe account. It does not spend the prepaid balance, and no `sentinel.*`
unit is metered.

| Unit | Price | Status |
|---|---|---|
| `sentinel.check_run` | $0.25 (250,000 µ$) | retired; history only |
| `sentinel.monitored_event` | $15 per 1M (15 µ$) | retired; history only |
| `sentinel.run` | $1.50 (1,500,000 µ$) | retired; history only |
| `sentinel.deep_audit` | $3.00 (3,000,000 µ$) | retired; history only |

- The four units keep their prices so existing ledger rows still price and
  render. `/internal/meters` refuses new charges on them with a 400, for every
  key. Sentinel's service key no longer opens `/internal/meters`.
- Auth: `SENTINEL_SERVICE_KEY` (never `WORKLOAD_HOST_KEY`) opens
  `/internal/sentinel/*` only: `accounts/resolve`, `accounts/link`,
  `tokens/resolve` and `keys`. The grant, summary, settle, settings,
  affordable and checkout routes are removed.
- Scope: the key touches only accounts in `sentinel_accounts` (created by
  Sentinel, or linked via `/internal/sentinel/accounts/link` after the owner
  consents in Sentinel). Otherwise 403 `account_not_linked`.
- Stripe: one account, two products. Sentinel creates its own customers and
  subscriptions and tags them `metadata.product = "sentinel"`. This site's
  webhook (`routes/billing-stripe.ts`) acks and ignores any event whose object
  carries that tag, and acts only on `kind: credits_topup` and
  `credits_refill`. This site never deletes, updates or merges Stripe
  customers it did not create.
- Cutover: owed usage (`sentinel.*` rows with `debited = false`) was waived
  (`source = 'sentinel:waived'`). Starter grants already credited stay as
  Secondlayer credit.

## Capacity at $10k/mo

- $10k/mo in row reads at $5/1M = 2B rows/mo ≈ 770 rows/sec; at the $2/1M
  volume rate, 5B rows/mo ≈ 1,930 rows/sec. Trivial for this Postgres.
- Break-even: $885 ÷ $50 avg spend ≈ 18 customers.
- $10k/mo ≈ 50 teams at $200 avg, or 20 heavy ones at $500.
- GTM universe is ~30–80 funded Stacks teams (STRATEGY.md). Hitting
  $10k/mo means roughly full penetration of that universe, or growth
  past it. Worth saying out loud.

## Out of scope here

Landing-page visuals, layout and copy. This file is the economic contract
those cite.
