# Plan 015: Remove webhook aliases after one published release

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat <010-landed-sha>..HEAD -- packages/api/src/create-app.ts packages/api/src/routes/openapi.ts packages/api/src/route-manifest.ts packages/sdk/src packages/cli/src/commands/webhooks.ts packages/mcp/src/tools/webhooks.ts packages/mcp/src/resources.ts packages/subgraphs/src/runtime/emitter.ts packages/shared/src/webhooks/chain-envelopes.ts apps/web/next.config.ts apps/console/next.config.ts apps/console/src/app/api`
> If any alias site moved, update the file:line list below before deleting.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (aliases already deprecated; remove only after one published release of 010)
- **Depends on**: one published release of 010
- **Category**: dx / cleanup
- **Planned at**: written by plan 010 executor, 2026-09-13

## Why this matters

Plan 010 made Webhooks canonical and kept Subscriptions names as one-cycle
aliases so customer scripts did not break on ship day. After that release has
published, the aliases must go: they are not a permanent dual surface.

## Aliases to remove (file:line at 010 land)

### REST

- `packages/api/src/create-app.ts:44-45` — `WORKLOAD_PATHS` entries `/api/subscriptions`, `/api/subscriptions/*`
- `packages/api/src/create-app.ts:142-143` — `app.route("/api/subscriptions", webhooksRouter)` + comment
- `packages/api/src/routes/openapi.ts:1382-1580` (approx) — all `/api/subscriptions…` path items (`deprecated: true`)
- `packages/api/src/route-manifest.ts:103` — `WORKLOAD_ROUTE_FIXTURES` `GET /api/subscriptions`
- `packages/api/src/route-manifest.ts:118` — `WORKLOAD_OPENAPI_PREFIXES` `/api/subscriptions`
- `packages/api/src/route-manifest.test.ts` — OpenAPI mirror assertion for `/api/subscriptions`
- `packages/api/test/webhooks.test.ts` — alias auth-shape test (keep canonical-only)

### SDK

- `packages/sdk/src/webhooks/client.ts` — `export const Subscriptions = Webhooks` (~159); `export type Subscriptions = Webhooks`; deprecated `CreateSubscriptionRequest` / `CreateSubscriptionResponse` / `UpdateSubscriptionRequest` / `SubscriptionDetail` / `SubscriptionSummary` / `SubscriptionTestResult` / `SubscriptionFormat` / `SubscriptionKind` / `SubscriptionRuntime` / `SubscriptionStatus` type aliases (~39-57)
- `packages/sdk/src/client.ts:72` — `ContextSnapshot.subscriptions` field
- `packages/sdk/src/client.ts:126` — `get subscriptions(): Webhooks`
- `packages/sdk/src/client.ts:258` — `subscriptions: webhooks` in `context()` return
- `packages/sdk/src/index.ts` — `Subscriptions` and deprecated type re-exports

### CLI

- `packages/cli/src/commands/webhooks.ts:988-1006` (approx) — hidden `program.command("subscriptions", { hidden: true })` + `subs` alias + stderr deprecation hook + `attachWebhookSubcommands(legacy)`
- `packages/cli/tests/webhooks-alias.test.ts` — delete or rewrite to assert removal

### MCP

- `packages/mcp/src/tools/webhooks.ts:289+` — all 13 `subscriptions_*` `defineTool` registrations (descriptions start `Deprecated alias of webhooks_`)
- `packages/mcp/src/resources.ts` — `PRODUCT_BLURBS.subscriptions`, `PRODUCT_ORDER` `"subscriptions"`, `whatExists.subscriptions`
- `packages/mcp/src/resources.test.ts` / `webhooks.test.ts` — drop the 13 alias names from expected lists

### Receiver dual-emit

- `packages/subgraphs/src/runtime/emitter.ts:426` — `subscription_id: sub.id` in `buildTestOutboxRow` payload (keep `webhook_id` only)
- `packages/shared/src/webhooks/chain-envelopes.ts:267` — optional `subscription_id?: string` on `ChainTestDelivery.data`
- SDK test fixture dual keys in `packages/sdk/src/__tests__/webhooks.test.ts`
- `packages/subgraphs/src/runtime/deliver-test-event.test.ts` dual-key assertion

### Docs / console redirects (keep permanent redirects; do not delete)

Docs and console redirects from `/docs/subscriptions` and `/console/subscriptions` stay. They are not runtime aliases of the API; they are URL permanence. Do not remove in 015 unless a later IA plan says so.

Still remove from console proxy allowlist:

- `apps/console/src/app/api/[...proxy]/route.ts:12` — drop `"subscriptions"` from `FORWARDED_ROOTS` (keep `"webhooks"`)

Redirect sources that may remain:

- `apps/web/next.config.ts` — `/subscriptions`, `/docs/subscriptions`, `/docs/subscriptions/:path*`
- `apps/console/next.config.ts` — `/subscriptions`, `/subgraphs/:name/subscriptions`, `/subgraphs/:name/subscriptions/:path*`

## Steps (sketch)

1. Delete every alias site listed above (except permanent docs/console redirects).
2. Update tests that asserted alias presence to assert absence (404 / not exported / not registered).
3. Changeset: patch on touched public packages noting alias removal.
4. Census: `rg -in subscription` on the public surfaces should be empty aside from redirects, changelog archive, stacks WebSocket `subscriptions`, and Streams SSE `subscribe`.

## STOP conditions

- 010 has not had a published npm release yet (aliases must ship before removal).
- Any external named request asks to keep an alias longer — escalate to founder.

## Done criteria

- [ ] No `/api/subscriptions` mount or OpenAPI paths
- [ ] No `Subscriptions` / `sl.subscriptions` / `subscriptions_*` / hidden CLI verb
- [ ] Test-ping payload has `webhook_id` only
- [ ] `bun run typecheck && bun run test` pass
