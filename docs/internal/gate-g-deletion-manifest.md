# Gate G deletion manifest

Status: DRAFT v2 — founder direction 2026-08-14: KEEP magic-link/accounts/sessions;
consolidate them to serve the metered archive only. Deletion scope narrows to
tenancy, plans, and hosted-console surface. Scope: P6.1–P6.4, P6.6–P6.12 (P6.5
satisfied — console shipped as `apps/console`, live at console.secondlayer.tools
2026-08-14). Rule: nothing in Slice C/D executes before its interlock clears.

## 0. Decisions

- **D1 — RESOLVED (founder, 2026-08-14): keep magic-link + accounts.** Auth is
  retargeted, not deleted: it becomes the metered-archive account system (balance,
  refill, caps, key management). No receipt-token build.
- **D2 — APPROVED IN PRINCIPLE: metered-archive mode.** Design a mode/flag for OUR
  public archive API where the read gates stay armed (`read-credits.ts:66`,
  `index/free-window.ts`, `streams/retention.ts`, `*/rate-limit.ts`) while
  self-host stays ungated. Design doc precedes Slice C.
- **D3 — OPEN — x402.** Retarget as operator-owned module or park-delete
  `src/x402/*` + `x402_payments`/`x402_balances` + reconcile job + Redis nonce
  store. STRATEGY says parked/not-a-revenue-line; deleting is smaller.
- **D4 — OPEN — BYO/multi-ORM.** Keep drizzle/prisma codegen (live CLI
  capability), delete the skip-gated BYO deploy path? Or freeze both.
- **D5 — leaning KEEP (caps are part of the retained account stuff).**

## 1. Metered-archive account system (KEEP + CONSOLIDATE — the commercial spine)

Survives whole: `accounts`, `sessions`, `magic_links`, `api_keys`,
`account_credits`, `processed_stripe_events`, `account_spend_caps`;
`routes/auth.ts` (magic link/verify/logout), `auth/email.ts` (Resend),
`requireAuth()` (both `ss-sl_` and `sk-sl_` paths), `auth/keys.ts`,
key mint (`auth/routes.ts` — simplified: no plan ceilings/tier mapping),
`routes/accounts.ts` `GET/PATCH /me` (drop `/usage*`), CLI
`login/logout/whoami/credits`. Web keeps `/login`, `/verify`, `/api/auth/*`,
`lib/auth.tsx` + auth-bar (now guarding only future credits/account surface).

Consolidation (refactor, not delete): strip plan/tier vocabulary out of the kept
auth (`resolveMintTier` ceilings, `accounts.plan`, tier params in mint);
`api_keys.tier` collapses to the single metered tier the credit gates expect;
`billing.ts` drops `/upgrade`, `/resolve`, `/cancel`, `/portal` and the
subscription half of `/status` — keeps balance/topup/refill/caps;
`webhooks-stripe.ts` drops `invoice.paid` + `customer.subscription.*` — keeps
`checkout.session.completed` + `payment_intent.succeeded`.

- `packages/platform` becomes the slimmed meter/account package (keep it — no
  extraction churn): KEEP `db/queries/accounts.ts` (incl. magic-link fns and
  `updateAccountProfile`; drop `setAccountPlan`, `isSlugTaken`),
  `account-credits.ts` (all 8 exports), `account-spend-caps.ts`,
  `schemas/accounts.ts`; DELETE `usage.ts`, `projects.ts`, `pricing.ts`.
- Also kept: `read-credits.ts` + both credits-gates; `index/auth.ts` +
  `streams/auth.ts` key→account resolution; `ip-rate-limit.ts` (+ store);
  `worker/jobs/credits-refill.ts`; `lib/stripe.ts` minus
  `resolveSubscriptionItem`; `routes/public-credits.ts` as-is.
- `apps/web` keeps `/api/public/credits/checkout` proxy and `lib/api.ts`
  (sessionToken path stays — auth survives) for the live `/archive` checkout.
- Env that stays: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`
  (magic-link + reindex-notify).

## 2. Slice A — safe now (no prod interlock)

Dead code, zero consumers verified:
- `packages/api/src/routes/v1-keys.ts` (unmounted); `packages/cli/src/commands/billing.ts`
  (unregistered); `worker/jobs/stripe.ts::shouldMeterTenant`; `apps/web` dep on
  `@secondlayer/platform` (zero imports); `apps/web/src/app/(www)/credits-buy.tsx`
  (orphan; update `www.smoke.test.tsx:27`).
- DB tables with zero live refs (DROP in Slice D, delist now): `tenant_usage_monthly`,
  `tenant_compute_addons`, `provisioning_audit_log`, `subgraph_usage_daily`.

apps/web hosted-CONSOLE surface (superseded by live apps/console — P6.7 web half;
auth pages SURVIVE per D1):
- KEEP: `src/app/login/`, `src/app/verify/`, `src/app/api/auth/**`,
  `src/lib/auth.tsx`, `src/components/auth-bar.tsx` — they now guard the metered
  account surface (credits balance/keys), not a console.
- DELETE: `src/app/platform/**` (24 files), `src/components/console/**` EXCEPT
  `logo.tsx` + `agent-prompt.tsx` (relocate — marketing imports), middleware
  host-split app.secondlayer.tools branch (login lives on the main domain; keep
  the `/subgraphs → /docs/subgraphs` redirect),
  `src/app/api/{subgraphs,subscriptions,status,insights,node,discovery}/**`
  (old-console-only; discovery also trims palette source
  `command-center/sources.ts:132`), dead `lib/queries/*` + `lib/intelligence/*`
  after. `src/app/api/billing/{topup,resolve}` move to whatever minimal credits
  page replaces the console billing screen (or delete if CLI-only).
- Post-slice validation: `bun run build` in apps/web; route/link scan shows no
  /platform or app.secondlayer.tools; `/archive` checkout + `/login` still work.
- CLI: DELETE `account/keys/project` commands (P6.8); KEEP
  `login/logout/whoami/credits` (metered-account verbs).

## 3. Slice B — meter consolidation + platform package slimming

Order: (1) `worker/jobs/ghost-sweep.ts` — retire with D3 if ghosts die; otherwise
keep but scope it to `ghost=true` rows only (it must never touch checkout
accounts); (2) consolidate the kept auth/billing surface (§1 refactor: strip
plans/tiers, slim billing + webhook); (3) repoint `route-manifest.ts` — reclassify
the KEPT surface (`/api/auth/*`, `/api/billing/{status,topup,refill,caps}`,
`/api/public/credits/*`, `/api/webhooks/stripe`, `/api/keys`, `/api/accounts/me`)
as RETAINED-METER and fix `route-manifest.test.ts` (the P6.1/P6.2 validation
instrument — update before the scans); (4) slim `packages/platform` to the meter
package (delete `usage.ts`, `projects.ts`, `pricing.ts`); (5) worker keeps
`credits-refill` (+`x402-reconcile` per D3, `spend-cap-alert` per D5).

## 4. Slice C — prod flip preconditions (separate approved migration)

The flip plan must resolve, in one window:
- D2 metered-archive mode implemented and deployed for api.secondlayer.tools.
- `console.secondlayer.tools` switched from `sk-sl_` key to `instanceTokenAuth`.
- Subgraph semantics: `subgraphs/{namespace,cache}.ts` +
  `shared/db/queries/subgraphs.ts` branch on mode (name resolution, PG schema
  naming, account scoping) — existing prod schemas were created under platform
  naming; write the reconciliation before flipping.
- DB split: `shared/db/index.ts:74,81` collapses SOURCE/TARGET to one URL off
  platform mode; prod is split since 2026-06-05 — reconcile or keep split-aware.
- Redis: `api/src/index.ts:35-39` refuses prod boot without REDIS_URL in platform
  mode; retire the guard with the mode flip (Redis stays only for ip-rate-limit
  + x402 per D3).
- `subscriptions.account_id`/`subgraphs` ownership columns become nullable/ignored,
  not dropped.

## 5. Slice D — destructive (post-flip only; auth is NOT in this slice)

- DELETE routers/middleware: `routes/{admin,projects,insights,wallet}.ts`,
  `middleware/{admin,usage}.ts`, `index/usage.ts`, `accounts.ts` `/usage*` routes,
  plan/tier authority (`index/tiers.ts`, `streams/tiers.ts`, `lib/tier-mapping.ts`,
  `auth/product-token-store.ts`, `auth/rate-limit.ts` account-plan limiter,
  `subgraphs/plan-limits.ts`, `auth/mint.ts` ceilings), billing `/upgrade
  /resolve /cancel /portal` + webhook subscription handlers,
  `routes/v1-api-keys.ts` + `auth/ghost.ts` per D3. `requireAuth`, sessions,
  magic links, key mint (simplified) all SURVIVE.
- DROP control tables: `projects`, `team_members`, `team_invitations`,
  `usage_daily`, `usage_snapshots`, `account_insights`, `account_agent_runs`,
  `tenants`, `instances` (verify vs `/v1/instance` first), the four zero-ref
  tables (§2), `claim_tokens` per D3. KEEP `sessions`, `magic_links`, meter +
  product tables (`table-plane.ts` updated in the same change — compile-enforced).
- `accounts` slims columns (drop `plan`/`slug`-era fields), stays a first-class
  table.
- Archive hosted-era migrations that only ever created now-dropped tables (P6.6
  letter: clean baseline == upgraded schema; prove with the migration parity test).
- Validation: import/route/export scans green against the UPDATED route manifest;
  `bun run self-host:smoke`; fresh `secondlayer init` → bootstrap → deploy →
  query; magic-link login + credits balance/topup still green against the
  metered archive API.

## 6. Slice E — isolation + periphery (parallel-safe after B)

- P6.9: move `@secondlayer/sdk/streams/rows` primitives (`StreamsEvent`,
  `StreamsEventType`, `DecodedEventRow`) into `@secondlayer/shared`; SDK re-exports;
  repoint 7 value-imports in `packages/indexer/src/decode/**`.
- P6.10: `docker/docker-compose*.yml` + Caddyfile + systemd + scripts stay in the
  internal ops boundary (unchanged, per infra freeze). `docker/Dockerfile` declared
  SHARED (oss + hosted build from one file) — document, don't split.
- P6.11: publisher (`packages/indexer/src/archive/`, 17 files) already has zero
  imports from api/worker/runtime; only shell+systemd invoke it. Formalize with a
  lint/test asserting the import boundary; `restore-snapshot.ts` stays reachable
  from the runtime (bootstrap input).
- P6.12: extract `packages/stacks` per its published-package plan (importers:
  clarity-docs, mcp, cli; `routes/wallet.ts` dies in D); D4 for BYO/ORM; audit
  `examples/*` (not in build graph) — build or delete; delete
  `docker/{STRIPE_MIGRATION.md,SCHEMA_SPLIT.md}` with the schema drop.

## 7. DO-NOT-DELETE (standing)

Metered-account system whole (§1: accounts, sessions, magic links, api_keys,
auth routes, requireAuth, key mint, web login/verify, CLI login/credits);
`docker/oss/**`; archive publisher + neutral archive primitives
(`packages/shared/src/archive/`); `restore-snapshot.ts`; systemd archive timers;
Stripe checkout/webhook (payment kinds); `RESEND_API_KEY` (reindex-notify);
`ip-rate-limit` on public checkout; the internal ops compose/Caddy/scripts
(P2.12 infra freeze — separate approval to change).

## Interlocks (ordered, v2 — auth survives, so the set shrinks)

1. `ghost-sweep` scoped/retired before any `accounts` column slimming (it must
   never touch checkout accounts).
2. Mode flip disarms meter gates — D2's metered-archive mode lands first; with
   auth kept, the prod console may simply keep its `sk-sl_` key (no token switch
   required).
3. Mode flip changes subgraph naming/scoping — reconciliation written first.
4. Mode flip collapses the DB split — reconcile `shared/db/index.ts`.
5. Redis boot-guard retires with the flip.
6. `route-manifest.ts` reclassification precedes all deletion scans.
7. apps/web platform-screen deletion must not touch the kept auth pages or the
   `/archive` checkout proxy.
