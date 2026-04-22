---
"@secondlayer/shared": minor
"@secondlayer/cli": patch
---

Pricing foundation (Sprint A) — switch from 14-day trial to activity-based auto-pause, org-level billing prep.

- Migration 0046 drops `tenants.trial_ends_at` + index, adds `tenants.last_active_at timestamptz NOT NULL DEFAULT now()` with index `(plan, last_active_at) WHERE status = 'active'`
- Migration 0047 adds nullable `tenant_id` to `usage_daily` (+ best-effort backfill for single-tenant accounts), widens the unique key to `(account_id, tenant_id, date)` so Sprint-C Stripe metering can bill per-tenant
- `TrialExpiredError` + `TRIAL_EXPIRED` code dropped (dead after trial removal)
- New `bumpTenantActivity(slug)` + `listIdleHobbyTenants(idleSince)` query helpers
- CLI drops trial-days-left from `sl instance info` and `sl whoami`, drops `TRIAL_EXPIRED` handlers
