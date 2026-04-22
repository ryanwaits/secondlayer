---
"@secondlayer/shared": minor
"@secondlayer/worker": minor
---

Soft spend caps with 80% threshold alerts — the core anti-surprise-bill differentiator.

- Migration 0050 adds `account_spend_caps` table (one row per account): monthly + per-line (compute/storage/ai) caps in cents, configurable `alert_threshold_pct` (default 80), `frozen_at`, `alert_sent_at`.
- New `@secondlayer/shared/db/queries/account-spend-caps` module: `getCaps`, `upsertCaps`, `freezeAccount`, `clearFreeze`, `listFrozenAccountIds`.
- Worker cron `spend-cap-alert.ts` runs daily: fetches each paid account's upcoming invoice, sends a Resend email at threshold, sets `frozen_at` at 100%. Alert email debounced per billing cycle via `alert_sent_at` comparison to `period_start`.
- Compute + storage metering crons now read `listFrozenAccountIds` at the top of each tick and skip frozen accounts entirely. Capped accounts keep running but stop accruing billable usage until the next cycle.
- Stripe `invoice.paid` webhook clears `frozen_at` + `alert_sent_at` on the paying account, unfreezing metering for the new cycle.
- Session-authed dashboard endpoints `GET /api/billing/caps` + `PATCH /api/billing/caps`. Raising a monthly cap mid-cycle auto-clears an active freeze (user explicitly said "yes, bill more").
