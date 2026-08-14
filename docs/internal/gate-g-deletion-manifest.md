# Gate G deletion manifest

Status: DRAFT for founder approval. Scope: P6.1–P6.4, P6.6–P6.12 (P6.5 satisfied —
console shipped as `apps/console`, live at console.secondlayer.tools 2026-08-14).
Rule: nothing in Slice C/D executes before its interlock clears. The meter survives.

## 0. Decisions required before execution

- **D1 — Credits balance read.** Today `GET /api/billing/status` needs a magic-link
  session; deleting auth makes balances write-only for guests. Options:
  (a) signed receipt token issued at checkout (stateless, no login) — recommended;
  (b) email one-time code (keeps an auth-ish flow alive);
  (c) accept loss (balance visible only via Stripe receipts). Affects
  `billing.ts:{248,426,546,594,606}`, `cli credits status/refill`.
- **D2 — Metered-archive mode.** `INSTANCE_MODE=oss` no-ops every read gate
  (`read-credits.ts:66`, `index/free-window.ts`, `streams/retention.ts`,
  `*/rate-limit.ts`) — credits become sellable but unspendable. Need a third mode
  (`archive-ops`) or a `METERED_READS=true` flag for OUR public archive API only.
  Self-host stays ungated.
- **D3 — x402.** Retarget as operator-owned module (P6.2 letter) or park-delete
  `src/x402/*` + `x402_payments`/`x402_balances` + reconcile job + Redis nonce store.
  STRATEGY says parked/not-a-revenue-line; deleting is smaller.
- **D4 — BYO/multi-ORM.** drizzle/prisma codegen is a live CLI capability; BYO tests
  are skip-gated. Keep codegen, delete BYO deploy path? Or freeze both.
- **D5 — Spend-cap alert job.** Keep (retarget email) or delete with caps.

## 1. Meter carve-out (KEEP — the commercial spine)

Minimal surviving model: `accounts(id,email,stripe_customer_id,created_at)` +
`api_keys(slim)` + `account_credits` + `processed_stripe_events` (+
`account_spend_caps` if D5 keeps caps).

- Extract into a dedicated meter module (new `packages/api/src/credits/` or
  `packages/shared`): `routes/public-credits.ts` (as-is);
  `createCreditsCheckoutSession`/`ensureStripeCustomer`/`CREDIT_PACKS_USD` out of
  `billing.ts`; webhook handlers `checkout.session.completed` +
  `payment_intent.succeeded` out of `webhooks-stripe.ts`;
  `platform/db/queries/account-credits.ts` (all 8 exports); `accounts.ts` slim four
  (`upsertAccount`, `getAccountById`, `setStripeCustomerId`,
  `getAccountByStripeCustomerId`); `read-credits.ts` + both credits-gates;
  `index/auth.ts` + `streams/auth.ts` key→account resolution; `ip-rate-limit.ts`
  (+ store) guarding checkout; `worker/jobs/credits-refill.ts`; `lib/stripe.ts`
  minus `resolveSubscriptionItem`.
- `apps/web` keeps `/api/public/credits/checkout` proxy + a stripped `lib/api.ts`
  `apiRequest` (no sessionToken) for the live `/archive` checkout.
- Env that stays: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`
  (reindex-notify only).

## 2. Slice A — safe now (no prod interlock)

Dead code, zero consumers verified:
- `packages/api/src/routes/v1-keys.ts` (unmounted); `packages/cli/src/commands/billing.ts`
  (unregistered); `worker/jobs/stripe.ts::shouldMeterTenant`; `apps/web` dep on
  `@secondlayer/platform` (zero imports); `apps/web/src/app/(www)/credits-buy.tsx`
  (orphan; update `www.smoke.test.tsx:27`).
- DB tables with zero live refs (DROP in Slice D, delist now): `tenant_usage_monthly`,
  `tenant_compute_addons`, `provisioning_audit_log`, `subgraph_usage_daily`.

apps/web hosted UI (superseded by live apps/console — P6.1/P6.7 web half):
- DELETE `src/app/login/`, `src/app/verify/`, `src/app/api/auth/**`,
  `src/lib/auth.tsx`, `src/components/auth-bar.tsx` (+ AuthProvider mount in
  `app/layout.tsx` — one edit, touches marketing), middleware host-split (all three
  branches; keep only `/subgraphs → /docs/subgraphs` redirect; drop `lib/urls.ts`
  `appHostname`), `src/app/platform/**` (24 files), `src/components/console/**`
  EXCEPT `logo.tsx` + `agent-prompt.tsx` (relocate — marketing imports),
  `src/app/api/{subgraphs,subscriptions,status,insights,node,discovery,billing}/**`
  (old-console-only; discovery also trims palette source `command-center/sources.ts:132`),
  session helpers in `lib/api.ts`, dead `lib/queries/*` + `lib/intelligence/*` after.
- Post-slice validation: `bun run build` in apps/web; route/link scan shows no
  /login, /platform, app.secondlayer.tools; `/archive` checkout still works.
- Note: app.secondlayer.tools DNS/Vercel host mapping retires with this slice.
- CLI `login/logout/account/whoami/keys/project` commands (P6.8) can also go now —
  BUT `credits status/refill` inherit D1; sequence those with D1's resolution.

## 3. Slice B — meter extraction + platform package deletion

Order: (1) retire `worker/jobs/ghost-sweep.ts` FIRST (it deletes `accounts` rows);
(2) build the meter module (§1); (3) repoint `route-manifest.ts` — reclassify
`/api/public/credits/checkout` + `/api/webhooks/stripe` as RETAINED and fix
`route-manifest.test.ts` (this is the P6.1/P6.2 validation instrument — update
before the scans); (4) delete `packages/platform` (remaining exports: `usage`,
`projects`, `pricing`, `schemas/accounts`, magic-link/plan halves of `accounts.ts`,
`account-spend-caps` per D5); (5) worker keeps `credits-refill` (+`x402-reconcile`
per D3, `spend-cap-alert` per D5) — package does NOT empty out.

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

## 5. Slice D — destructive (post-flip only)

- DELETE routers/middleware: `routes/{auth,accounts,admin,projects,insights,wallet}.ts`,
  `auth/{routes,mint,email,ghost,rate-limit,product-token-store}.ts`,
  `routes/v1-api-keys.ts`, `middleware/{admin,usage}.ts`, `index/usage.ts`,
  plan/tier authority (`index/tiers.ts`, `streams/tiers.ts`, `lib/tier-mapping.ts`,
  `subgraphs/plan-limits.ts`), billing/webhook subscription halves,
  `requireAuth()` LAST (console must already be on instanceTokenAuth).
- DROP control tables: `sessions`, `magic_links`, `claim_tokens`, `projects`,
  `team_members`, `team_invitations`, `usage_daily`, `usage_snapshots`,
  `account_insights`, `account_agent_runs`, `tenants`, `instances` (verify vs
  `/v1/instance` first), + the four zero-ref tables (§2). Keep meter + product
  tables (`table-plane.ts` updated in the same change — it's compile-enforced).
- Archive ~50 hosted-era migrations outside the fresh-install path (P6.6 letter:
  clean baseline == upgraded schema; prove with the existing migration parity test).
- CLI: delete hosted commands per Slice A note + D1.
- Validation: import/route/export scans green against the UPDATED route manifest;
  `bun run self-host:smoke`; fresh `secondlayer init` → bootstrap → deploy → query.

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

Meter tables + module (§1); `api_keys` while prod console rides an `sk-sl_` key;
`docker/oss/**`; archive publisher + neutral archive primitives
(`packages/shared/src/archive/`); `restore-snapshot.ts`; systemd archive timers;
Stripe checkout/webhook (payment kinds); `RESEND_API_KEY` (reindex-notify);
`ip-rate-limit` on public checkout; the internal ops compose/Caddy/scripts
(P2.12 infra freeze — separate approval to change).

## Interlocks (ordered, from the inventory)

1. `api_keys`/`accounts`/`requireAuth` untouchable until prod API runs the
   self-host auth and console switches tokens.
2. `ghost-sweep` retires before any `accounts` slimming.
3. Mode flip disarms meter gates — D2 lands first.
4. Mode flip changes subgraph naming/scoping — reconciliation written first.
5. Mode flip collapses the DB split — reconcile `shared/db/index.ts`.
6. Redis boot-guard retires with the flip.
7. `route-manifest.ts` reclassification precedes all deletion scans.
8. `apps/web/lib/api.ts` split (checkout keeps a stripped apiRequest) precedes
   web proxy deletion.
