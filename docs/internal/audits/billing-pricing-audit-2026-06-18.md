# Billing & Pricing Implementation Audit — 2026-06-18

Multi-agent technical audit (5 subsystem readers + 28 adversarial verdicts, all
source-grounded) of plan tiers, x402, PAYG/usage metering, and free-tier rate
limiting. Goal: verify the rails are wired correctly, map every limit, and flag
gaps for discussion.

All file:line references are against `main` at the time of audit.

---

## TL;DR

| Question | Answer | Verdict |
|---|---|---|
| Does metered/PAYG get charged on paid monthly plans? | **No — never.** PAYG debit is hard-gated to `tier === "free"`. | Confirmed |
| Do plan limits still apply on paid tiers? | **Yes** — rate limit, slots, webhook count, retention all enforced per tier. | Confirmed |
| Is there overage (charge beyond included limits)? | **Not implemented.** Pure hard-caps; overage scaffolding exists but is inert. | Confirmed |
| Can x402 + Stripe double-charge the same account/request? | **No** — structurally mutually exclusive. | Confirmed |

---

## 1. Two money rails, cleanly separated

- **Stripe (flat monthly):** Pro/`launch` $79, Scale/`scale` $299, Enterprise custom
  (`packages/platform/src/pricing.ts:44,62`). Bought once, not per-request.
- **PAYG prepaid credits (`account_credits`):** card-funded one-time top-up,
  debited per row on reads at **$5 / 1M rows** ($2/1M at ≥$50/mo spend)
  (`packages/api/src/lib/read-credits.ts:17-23`).
- **x402 (wallet-funded, on-chain):** accountless agents pay per call
  ($0.001 read / $2 deploy / $0.50 renew / $0.25 deposit floor)
  (`packages/api/src/x402/catalog.ts`).

**No double-charge.** `resolveCreditedAccount` returns `undefined` unless
`tier === "free"` (`read-credits.ts:44`), and x402 `if (isAccountBacked(c)) return next()`
short-circuits first thing for any resolved tenant (`x402/middleware.ts:196`). A
Stripe-paid account therefore triggers neither per-row credits nor x402 — flat fee
only. The credits balance "never folds into the subscription invoice"
(`routes/billing.ts:390`). `account_credits` is credited only by a one-time
`credits_topup` checkout (`webhooks-stripe.ts:255-272`) and debited only on
free-tier reads (the sole `debitCredits` caller is `debitCreditedRows`).

---

## 2. Metered / PAYG charging on paid plans — CONFIRMED bypassed

Plan → product tier mapping (`auth/product-token-store.ts:39-53`, applied at `:103`
via `tier: key.tier ?? accountPlanToProductTier(key.plan)`):

- `none` / `hobby` / unknown → `free`
- `launch` / `pro` / `build` / `builder` → `build`
- `scale` → `scale`
- `enterprise` → `enterprise`

`resolveCreditedAccount` requires `tier === "free"`, so launch/scale/enterprise
accounts never get a `credited` context → `debitCreditedRead` / `debitStreamsCreditedRead`
no-op. Per-row debit is gated to free-tier prepaid accounts only. This is correct
by design: paid plans buy flat subscription + limits, not metered usage.

`usage_daily` / `tenant_usage_monthly` are **pure counters** for display / future
billing — nothing converts them to a charge today (`platform/src/db/queries/usage.ts`).

---

## 3. Overage — NOT implemented (hard caps only)

Verified decisively: no code path charges beyond a paid plan's included limits.

- `meteredCents = 0` hardcoded — *"No per-unit overage rates exist yet"*
  (`routes/accounts.ts:83-88`).
- `shouldMeterTenant()` defined, **zero callers**; `stripe.billing.meterEvents.create`
  **never called anywhere** (`worker/jobs/stripe.ts:38`). `stripe.ts:91` only *skips*
  metered line items when picking the tier price — never creates/reports them.
- Exceed a limit → throttled (429), refused (403), or pushed to cold dumps (402).
  Never billed for overflow.

This is correct if the intended model is **"flat sub + hard limits."** It is a gap
only if metered overage was intended. See §6 bug #1 for the inert freeze machinery.

---

## 4. Rate-limit & free-tier map

### 4.1 Data reads (`/v1/index`, `/v1/streams`) — per-SECOND tier buckets

| Caller | Index | Streams | Bucket | Notes |
|---|---|---|---|---|
| **Anon / keyless** | 10 req/s | 50 req/s | single **GLOBAL** `index:anon` / `streams:anon` | Index open by default; Streams key-mandatory unless x402 on |
| **Free API key** (`plan=none`→`free`) | 10 req/s | 10 req/s | per-tenant `index:account:<id>` | Same number as anon but *dedicated* bucket |
| **Pro** (`launch`→`build`) | 250 req/s | 250 req/s | per-tenant | ✓ matches `pricing.ts` |
| **Scale** | 500 req/s | 500 req/s | per-tenant | ✓ matches `pricing.ts` |
| **Enterprise** | unlimited | unlimited | — | `null` limit |
| **`credited` free acct** (PAYG) | **unthrottled** | **unthrottled** | — | bypasses rate limit + retention + free-window; bounded only by prepaid balance |

Window = 1000ms (`index/rate-limit.ts:11`). Source: `index/tiers.ts:10-19`,
`streams/tiers.ts:32-38`. Tier numbers match `pricing.ts` exactly.

- **Free read window** ~24h (17280 blocks) for anon + free on Index (`index/free-window.ts`).
- **Retention:** free 1d / build 30d / scale 90d / enterprise unlimited (`streams/tiers.ts:35-38`).
- Self-hosted / dedicated (`!isPlatformMode()`) skips the data-surface throttle entirely.

### 4.2 Other limiters (separate namespaces)

- **IP limiter** `ipRateLimit(10)` = **10 req / 60s per client IP**, mounted **only on
  `/api/auth/*`** (magic-link) (`index.ts:136`, `auth/ip-rate-limit.ts`).
- **Legacy apikey limiter** = **120/min** default, mounted **only on `/api/*`**
  control-plane, keyed `key_hash` (`auth/rate-limit.ts:8`). Not on data reads.

### 4.3 Non-rate quotas (all HARD CAPS, 403 / clamp)

| Quota | none / free | Pro | Scale | Ent |
|---|---|---|---|---|
| Subgraph slots | 0 | 15 | 50 | ∞ |
| Webhook subscriptions | 0 | 25 | ∞ | ∞ |
| Private visibility | ✗ | ✓ | ✓ | ✓ |
| Genesis / backfill | ✗ (forward-only clamp) | ✓ | ✓ | ✓ |
| New subgraph deploy | ✗ (`PLAN_REQUIRED`) | ✓ | ✓ | ✓ |

Source: `subgraphs/plan-limits.ts`.

---

## 5. x402 rail (verified correct)

- Enablement = `Boolean(process.env.X402_SPONSOR_KEY)` (no separate flag); a working
  rail also needs `X402_PAY_TO` else 503 `PAYMENT_RAIL_UNAVAILABLE`. Live in prod
  per `project_x402_activation.md`.
- Account-backed callers (any resolved tenant, incl. free keyed) bypass x402 entirely;
  x402 is the accountless path only.
- Per-call exactness enforced on-chain: SIP-010 via Deny-mode FT post-condition
  (amount + asset pinned), native STX via the signed `TokenTransfer` payload
  (consensus disallows post-conditions). Facilitator sponsors gas (gasless for agent).
- Confirmed-tier finality verified against our own `decoded_events` (`canonical=true`),
  not external RPC. Double-redemption blocked by `UNIQUE(nonce, txid)`.

Residual x402 risks (accepted-design or low severity): optimistic-serve fraud window
(bounded by velocity gate + strike reputation, fail-closed); a slow-confirming
confirmed-tier deposit can settle on-chain but throw `awaiting_confirmation` with no
ledger row → charged but credited nothing (reconciler only scans last 2h); deposit
credits requested USD, not the settled token amount (spot drift, sub-cent).

---

## 6. Bugs / gaps / risks

### Bugs

**#1 — Spend-cap freeze was inert. FIXED (re-aimed at the credits rail, option a).**
Before: `frozen_at` was set by the daily cron when the projected *Stripe subscription*
invoice ≥ cap, but (i) no request middleware ever read `frozen_at`, and (ii) the
projection was the flat base price (`meteredCents = 0`), while the only live variable
spend — PAYG credits — is on free-tier accounts the cron skipped. The cap did nothing.

Fix:
  - **Real-time enforcement (authoritative):** `resolveCreditedAccount`
    (`api/lib/read-credits.ts`) now stops crediting once this month's PAYG credit spend
    reaches `monthly_cap_cents` → reads fall back to the free-tier window. Comparison
    extracted to the pure, unit-tested `isOverMonthlyCreditCap` (1¢ = 10,000 µ$, freeze
    on reach). The prepaid balance remains the bill-shock ceiling; the cap is the
    user's softer in-month ceiling.
  - **Cron re-aimed (`worker/jobs/spend-cap-alert.ts`):** projects from
    `getMonthlyCreditsSpend` (not the Stripe invoice), sets `frozen_at` as a display +
    email mirror, auto-clears it when spend resets under the cap (month rollover), and
    debounces alerts per calendar month. Stripe dependency dropped.
  - Email copy + `frozen_at` doc comment rewritten to describe paused metered reads /
    untouched prepaid balance, not nonexistent "overages."

  Note: this makes the cap real for the credits rail only. Paid-plan metered overage
  still does not exist (§3) — that remains option (b), tied to the usage-pricing rework.

**#2 — CLI `billing` printed a false "no limits, no charges" for free accounts.**
`cli/src/commands/billing.ts` told no-subscription users "Free during open beta /
$0 — no limits, no charges" while the API enforces 10 req/s, forward-only indexing,
and `PLAN_REQUIRED` on deploy. **Fixed** — now shows the real Free-tier limits +
upgrade URL.

**#3 — Stale comments. Fixed.**
  - `routes/subscriptions.ts:167` said "free 3 / Pro 25" but the `none` quota is 0 →
    corrected.
  - `streams/tiers.ts:30` claimed `STREAMS_ANON_RATE_LIMIT_PER_SECOND` "Mirrors
    `INDEX_ANON_RATE_LIMIT_PER_SECOND`" but it's 50 vs 10 → corrected to note the
    intentional divergence (only reachable post-x402-payment) + that it's a shared
    global bucket.

**#4 — NOT a bug (false positive).** Migration 0069's `api_keys_tier_check`
(`tier IN ('free','build','scale','enterprise')`) was flagged for "omitting launch."
On inspection the `api_keys.tier` column stores **product tiers** (`MintTier`), not
plan ids — plan `launch` maps to product tier `build` at lookup, and is never written
to that column (`auth/mint.ts:62-67`, `MintTier` type). The constraint is correct by
design; no change (and altering an applied migration would be wrong regardless).

### Risks (security / abuse)

- **Anon limit is a single GLOBAL bucket** (`index:anon` / `streams:anon` /
  `subgraphs:anon`) — one caller doing 10 req/s 429s every anon visitor (self-DoS),
  and IP-rotating attackers aren't individually capped.
- **IP limiter trusts spoofable `X-Forwarded-For` first hop**, and `IP=="unknown"`
  bypasses the limiter entirely (`auth/http.ts:5`, `auth/ip-rate-limit.ts:12`) →
  magic-link spray bypass.
- **Rate limiters fail OPEN** on Redis timeout (>250ms) / outage — enforcement off
  during Redis degradation (`auth/rate-limit-store.ts:130`). (Nonce store correctly
  fails *closed*.)
- **In-proc store (no `REDIS_URL`) is per-instance** → horizontal scale silently
  multiplies effective limits ×N. Confirm prod sets `REDIS_URL`.
- **`credited` free account is fully unthrottled** and the per-row debit is
  best-effort (not atomic with the read) → process death between serve and debit =
  free reads; abuse bounded only by prepaid balance.
- **`api_keys.tier` overrides `plan→tier`** — if a paid account's key ever carried
  `tier="free"`, it'd be metered *and* subscribed. No creation path found today; latent.

### Enhancements

- Per-IP (or per-key) anon buckets instead of one global counter.
- Derive product tier from `PLANS` rather than the parallel `accountPlanToProductTier`
  switch (an unknown plan string silently falls through to `free` → a paid customer
  could be throttled to free if the plan string drifts).
- Separate `X402_ENABLED` kill switch independent of the funded sponsor key.
- **Scale is self-serve** via `POST /api/billing/upgrade` despite the "contact-sales
  only" comment (`pricing.ts:59`, `tier-mapping.ts`, `billing.ts:116-170`) — gate
  server-side or embrace it.
- Pricing copy under-claims Scale (unlimited webhooks + 50 slots unadvertised).

---

## 7. Changes made in this pass

- `packages/api/src/lib/read-credits.ts` (+ `read-credits.test.ts`) — real-time
  monthly-credit-cap enforcement in `resolveCreditedAccount` + pure
  `isOverMonthlyCreditCap` helper (bug #1).
- `packages/worker/src/jobs/spend-cap-alert.ts` — cron re-aimed from the Stripe
  subscription invoice to monthly credit spend; auto-unfreeze; updated email copy (bug #1).
- `packages/shared/src/db/types.ts` — `frozen_at` / `monthly_cap_cents` doc comment (bug #1).
- `packages/cli/src/commands/billing.ts` — accurate Free-tier copy (bug #2).
- `packages/api/src/routes/subscriptions.ts` — corrected quota comment (bug #3a).
- `packages/api/src/streams/tiers.ts` — corrected anon-limit comment (bug #3b).

Bug #4 confirmed non-issue (no change). All changes uncommitted on `main`.

## 8. Verification pass + sprint plan

The §6 risks/enhancements were re-traced by a 12-agent verification pass and rolled
into **`docs/sprints/billing-hardening/plan.md`** (4 sprints, by severity × leverage).
Verdict deltas vs the §6 first-pass guesses:

- **#5 balanceDrawdown — REFUTED.** Drawdown works: the `undefined` session secret
  falls through to `getSessionSecret()` (== mint secret); proven by a round-trip test.
  No fix. Caveat: prod must have `SECONDLAYER_SECRETS_KEY` set (else deposit 503s
  before minting → no inconsistency).
- **R7 — upgraded to HIGH** (real fund loss: confirmed-tier deposit charged on-chain
  but never credited, no recovery sweep). Top of Sprint 1.
- **R4, R5 — downgraded to low** (prod defaults to Redis + 2 replicas; credited
  population ≈ 0 today). R5 deferred.
- **R6 — has a real reachability path** (ghost-key merge can ride `tier='free'` onto a
  paid account), not purely latent.
- R1/R2/R3/E2/E3/E4/E5 confirmed broadly as described.
