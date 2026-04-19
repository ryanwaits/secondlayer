# Post-Migration Cleanup Checklist

Shared-tenancy code paths to remove AFTER all customers are migrated to per-tenant dedicated instances.

**Do not run this until:**
1. Every account has a `tenants` row (not just yours)
2. Every tenant container has been running cleanly for ≥30 days
3. Source DB `subgraph_<prefix>_<name>` schemas have been dropped (manually or via `--drop-source-schemas` on the migration script)

The cleanup has two phases:
- **Phase A — DB cleanup**: drop tables + columns that only platform-mode needed
- **Phase B — Code cleanup**: delete paths that handled shared-tenancy ownership

Each item below lists file path, what to remove, and why it's safe.

---

## Phase A — DB schema cleanup (migrations)

Write as one migration: `00XX_drop_shared_tenancy_columns.ts`.

### A.1 Drop `subgraphs.api_key_id` column

- After every subgraph is in a tenant DB, the source `subgraphs` table is empty.
- Tenant DBs have their own `subgraphs` with `api_key_id = NULL`.
- Migration `0037_nullable_api_key.ts` already made it nullable. Now fully drop.

```sql
ALTER TABLE subgraphs DROP COLUMN api_key_id;
DROP INDEX IF EXISTS subgraphs_name_unique_no_key;
-- Restore simple uniqueness on name alone:
ALTER TABLE subgraphs ADD CONSTRAINT subgraphs_name_unique UNIQUE (name);
```

### A.2 Consider dropping `accounts`, `api_keys`, `sessions` (platform-only)

Only if you're ALSO moving auth to per-tenant. Keep these on the control plane DB (shared) in the near term — they identify customers + drive the dashboard login flow. Drop only when auth goes per-tenant too (out of current scope).

### A.3 Drop residual `workflow_*` references in types.ts

Migration `0038_drop_workflow_tables.ts` already dropped the tables. TypeScript types in `packages/shared/src/db/types.ts` at lines 279-368 + 391-398 + 401-508 still exist.

```typescript
// packages/shared/src/db/types.ts — remove:
//   - WorkflowDefinitionsTable, WorkflowRunsTable, WorkflowStepsTable
//   - WorkflowQueueTable, WorkflowSchedulesTable, WorkflowCursorsTable
//   - WorkflowSignerSecretsTable, WorkflowBudgetsTable
//   - All corresponding Selectable/Insertable/Updateable type aliases
//   - All entries in the `Database` interface
```

### A.4 Drop `api_request_logs` / shared usage tables (if any)

Usage tracking moves per-tenant. Keep on source DB only if billing joins across tenants is needed.

---

## Phase B — Code cleanup

### B.1 `pgSchemaName` simplification

**File**: `packages/shared/src/db/queries/subgraphs.ts`

Currently:
```typescript
export function pgSchemaName(subgraphName: string, accountPrefix?: string): string {
  const safeName = subgraphName.replace(/-/g, "_");
  if (!accountPrefix) return `subgraph_${safeName}`;
  const safePrefix = accountPrefix.replace(/-/g, "_");
  return `subgraph_${safePrefix}_${safeName}`;
}
```

Simplify to:
```typescript
export function pgSchemaName(subgraphName: string): string {
  const safeName = subgraphName.replace(/-/g, "_");
  return `subgraph_${safeName}`;
}
```

Ripple effects to audit:
- `packages/subgraphs/src/runtime/block-processor.ts:141` — remove the `subgraphRecord?.schema_name` fallback check, since every schema_name is now canonical.
- `packages/api/src/routes/subgraphs.ts` — any call with `accountPrefix` arg drops the second param.

### B.2 Ownership helpers

**File**: `packages/api/src/lib/ownership.ts`

Currently has mode-gated logic:
```typescript
export async function assertSubgraphOwnership(db, subgraphName, accountId) {
  // ... loads subgraph ...
  if (!isPlatformMode()) return subgraph;
  if (accountId && subgraph.account_id && subgraph.account_id !== accountId) {
    throw new ForbiddenError(...);
  }
  return subgraph;
}
```

Once platform mode is gone:
- Remove `isPlatformMode()` + all mode checks
- Remove `account_id` filtering entirely (tenant DB is single-tenant by definition)
- Keep function signature for compatibility, but body reduces to "load subgraph, return if exists"

Files with similar pattern to simplify:
- `packages/shared/src/db/queries/subgraphs.ts` — `getSubgraph`, `listSubgraphs`, `deleteSubgraph` — drop the optional `accountId` parameter.
- `packages/api/src/subgraphs/cache.ts` — `SubgraphRegistryCache.get/getAll` — drop the `accountId` param.

### B.3 `resolveKeyIds` / `resolveApiKeyIdForWrite`

**File**: `packages/api/src/lib/ownership.ts`

Currently iterates over account's active API keys to build a filter. Post-migration:
- Tenant API authenticates via HS256 JWT (no `api_keys` table in tenant DB)
- These functions always return `undefined`
- Delete both functions. Every caller already treats `undefined` as "no filter" → no behavior change.

### B.4 Platform-mode-only route mounting

**File**: `packages/api/src/index.ts`

Currently:
```typescript
if (mode === "platform") {
  app.route("/api/keys", keysRouter);
  // ...auth, waitlist, marketplace, admin, accounts, insights, projects, chat-sessions, tenants
}
```

Two options post-migration:
1. **Keep the mode flag**, delete the `oss` and `dedicated` branches entirely (simpler, no mode-switching at runtime).
2. **Remove the flag**, mount everything unconditionally (cleaner, loses OSS/dedicated flexibility).

Recommended: keep the flag but delete the `platform`-specific conditional since platform mode is the default and dedicated mode only exists per-tenant (which has its own API image built from the same codebase). OSS users just don't mount platform routes — they're harmless dead code in the image.

### B.5 Instance modes — consolidate

**File**: `packages/shared/src/mode.ts`

Once platform is fully dedicated:
- Keep `oss | dedicated` — drop `platform`
- Update `isPlatformMode()` → delete
- Update every call site to check mode explicitly if needed

Files touching `isPlatformMode()` / `getInstanceMode()`:
- `packages/api/src/lib/ownership.ts`
- `packages/api/src/subgraphs/cache.ts`
- `packages/api/src/routes/subgraphs.ts`
- `packages/worker/src/jobs/tenant-trial.ts`
- `packages/worker/src/jobs/tenant-health.ts`
- `packages/api/src/index.ts`

### B.6 Worker tenant crons

**File**: `packages/worker/src/jobs/tenant-trial.ts` + `tenant-health.ts`

These manage tenants in the control plane DB. Keep them running post-migration — they still do trial expiry + health monitoring. No changes needed unless you consolidate workers into one shared cron runner.

### B.7 Delete `apps/web/src/app/platform/workflows/*`

After post-migration cleanup you can also consider deleting the dormant workflow pages since they reference types from `packages/shared/src/db/types.ts` that were removed in A.3. Not strictly required — the pages silently fail if invoked — but removes dead routes.

### B.8 Delete dormant workflow packages

Per `~/.claude/plans/workflows-v3-mvp.md` Appendix A — if you want a true clean slate before reviving workflows as Sentry:
- `packages/workflows/`
- `packages/workflow-runner/`
- `packages/signer-node/`
- Subpaths in `packages/stacks/`: `broadcast.ts`, `errors.ts`, `tools/`, `triggers/`, `ui/`, `tx/`
- SDK subpath `packages/sdk/src/workflows/`
- MCP tools `packages/mcp/src/tools/workflows.ts`
- CLI `packages/cli/src/commands/workflows.ts` + `secrets.ts`
- Bundler subpath `packages/bundler/src/workflow.ts` + `lint-broadcast.ts`

---

## Phase C — Infrastructure cleanup

### C.1 Drop the platform shared postgres

After migration, the shared postgres holds only:
- `blocks`, `transactions`, `events`, `index_progress` (the source indexer DB — keep indefinitely)
- `accounts`, `api_keys`, `sessions`, `tenants` (control plane — keep)
- `subgraphs` registry table (becomes empty once all rows are in tenant DBs — can drop the table if you drop routes that query it)

Decision: keep the shared postgres. Rename the logical split internally — "control plane DB" for auth/tenants/account tables; "source indexer DB" for blocks/transactions/events. Can live on the same physical postgres (just different databases) or be split later if scaling demands it.

### C.2 Caddy wildcard + on-demand TLS (tenant HTTPS)

Tenant public URLs (`{slug}.{BASE_DOMAIN}`) are served by the existing Caddy via a wildcard block + on-demand TLS. Activation steps — see `docker/docs/OPERATIONS.md` and §6.2 of `DEDICATED_HOSTING.md`:
1. Add wildcard DNS A record `*.{BASE_DOMAIN}` → app-server IP.
2. Set `BASE_DOMAIN` + `CADDY_ACME_EMAIL` in `.env` (replace old `DOMAIN`).
3. `$COMPOSE up -d --force-recreate caddy` — reloads Caddyfile + joins `sl-tenants`.
4. Provision a test tenant; `curl -I https://<slug>.{BASE_DOMAIN}` — expect 401 (TLS + routing OK).

### C.3 Update GitHub Actions OSS image workflow

`.github/workflows/oss-images.yml` already publishes `api` + `indexer` images. Post-migration, also publish:
- `provisioner` image (new target in Dockerfile)
- `worker` image (if OSS users want trial/health crons — probably not useful for OSS, skip)

---

## Post-cleanup verification

```bash
# Platform DB no longer has customer-shaped data
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT count(*) FROM subgraphs;"
# → 0 (all subgraphs live in tenant DBs now)

# Every tenant has its own PG container
docker ps --filter "label=secondlayer.role=postgres" \
  --format "table {{.Names}}\t{{.Label \"secondlayer.slug\"}}"

# Every tenant has exactly one API + one processor container
docker ps --filter "label=secondlayer.slug={slug}" \
  --format "table {{.Names}}\t{{.Label \"secondlayer.role\"}}"
# → sl-pg-{slug}, sl-api-{slug}, sl-proc-{slug}

# Build + tests still green after all removals
bun run build
bunx tsc --noEmit
bun run test
```

---

## Rollback plan

If something breaks mid-cleanup:

1. **Phase A (DB)**: each migration has a `down()`. Roll back with `migrator.migrateDown()`. Columns come back as nullable; data you already lost (none, since all we drop is an FK column and an empty workflow table) is gone.
2. **Phase B (code)**: revert the commit via `git revert`. Redeploy.
3. **Phase C (infra)**: revert the Caddyfile (drop wildcard block + on_demand_tls stanza) and recreate Caddy — existing `api.{BASE_DOMAIN}` block is unchanged, so platform API keeps serving.

---

## Not covered (future sprints)

- **Billing integration** — Stripe hookup. Tenants table already has `plan` + resource fields; just need Stripe subscription sync.
- **Multi-host provisioning** — current assumption: all tenants on one Hetzner box. When you hit ~40 tenants, multi-host coordination becomes an issue. Needs a distributed provisioner scheduler.
- **Per-tenant backups** — add `pg_dump` cron per tenant container, store in object storage.
- **Workflows revival** — see `~/.claude/plans/workflows-v3-mvp.md` for the full v3 plan when you're ready.
