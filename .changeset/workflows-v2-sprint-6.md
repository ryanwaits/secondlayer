---
"@secondlayer/stacks": patch
"@secondlayer/web": patch
---

Workflows v2 — Sprint 6 polish + release readiness.

**Fee estimation (runner):** `broadcast()` now drives the default fee off the Stacks node's `/v2/fees/transaction` estimate when `maxFee` isn't supplied. Uses the "medium" tier; falls back to the 10k µSTX default if the estimate endpoint fails. Workflow authors who pass `maxFee` retain the hard ceiling; authors who omit it get realistic fees automatically.

**Docs:** `/workflows` marketing page gets small Broadcast + Budgets sections with end-to-end examples. `awaitConfirmation: true` documented inline in the broadcast example. Replaces the earlier "Coming soon" placeholder. Kept terse and code-heavy — no sprawl.

**Deferred to a v2.1 polish:**
- Dashboard burn-down UI for budgets — counters are tracked + enforced today; dashboard visibility is cosmetic (CLI and API can surface the same data)
- In-dashboard secret rotation UI — CLI (`sl secrets rotate`) remains the primary path

This sprint is the final v2 commit before publishing. Migrations `0033` – `0036` all outstanding; `SECONDLAYER_SECRETS_KEY` required in Hetzner env (already set per 2026-04-17).
