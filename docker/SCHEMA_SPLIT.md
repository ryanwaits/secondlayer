# Database split: SOURCE vs TARGET

Isolates the chain plane (write-heavy, reconstructable, hundreds of GB) from the
control plane (small, must-never-lose) into two Postgres instances, so neither
can starve or take down the other. **Not** a scaling mechanism — that's read
replicas. See `ARCHITECTURE.md`.

Resolution (already wired in `@secondlayer/shared/db`):
- `getSourceDb()` → `SOURCE_DATABASE_URL || DATABASE_URL`
- `getTargetDb()` → `TARGET_DATABASE_URL || DATABASE_URL` (`getDb()` aliases this)

When only `DATABASE_URL` is set both resolve to one DB — the split is a no-op,
so all of this is safe to merge and deploy before any cutover.

> **Canonical mapping:** `TABLE_TO_DB` in
> `packages/shared/src/db/table-plane.ts` is the machine-readable source of truth
> for which plane each table belongs to (type-enforced exhaustive vs
> `keyof Database`). The lists below + the cutover script's `CONTROL_TABLES` are
> human mirrors of it, guarded by `table-plane.test.ts`.

## SOURCE (chain + decoded)

Written by the `indexer` and `l2-decoder` services. Read by the public API.

- Raw chain: `blocks`, `transactions`, `events`, `transactions_archive`,
  `events_archive`, `mempool_transactions`, `dead_letter_events`,
  `index_progress`, `contracts`, `chain_reorgs`, `service_heartbeats`
- Decoded (L2): `decoded_events`, `l2_decoder_checkpoints`, `pox4_calls`,
  `pox4_cycles_daily`, `pox4_signers_daily`, `burn_block_rewards`,
  `burn_block_reward_slots`, `sbtc_events`, `sbtc_token_events`,
  `sbtc_supply_snapshots`, `bns_name_events`, `bns_namespace_events`,
  `bns_marketplace_events`, `bns_names`, `bns_namespaces`

Decoded tables live on SOURCE (not TARGET): they are chain-derived, written by
the decode pipeline, and the API already reads them via `getSourceDb()`. Keeping
them on SOURCE avoids cross-DB reads.

## TARGET (control plane)

Written by `api`, `worker`, `subgraph-processor`.

- Accounts/auth/billing: `accounts`, `api_keys`, `sessions`, `magic_links`,
  `usage_daily`, `usage_snapshots`, `account_insights`, `account_agent_runs`,
  `processed_stripe_events`, `tenants`, `tenant_usage_monthly`,
  `tenant_compute_addons`, `account_spend_caps`, `provisioning_audit_log`,
  `subscriptions`, `subscription_outbox`, `subscription_deliveries`,
  `trigger_evaluator_state`, `projects`, `team_members`, `team_invitations`,
  `chat_sessions`, `chat_messages`
- Subgraphs + per-tenant schemas: `subgraphs`, `subgraph_*`

## Migration order (critical)

1. Reroute chain/decoded **writes** to `getSourceDb()` and deploy — single-DB,
   zero behavior change. (G4-S1) — shipped
2. Dual-DB migrate + `postgres-platform` container + `assertDbSplit` guard,
   gated behind `SOURCE_/TARGET_DATABASE_URL`. (G4-S2) — shipped
3. Cutover: snapshot, move the small control-plane tables + per-tenant subgraph
   schemas to TARGET, flip env (set `SOURCE_/TARGET_DATABASE_URL`, blank
   `DATABASE_URL` — the LISTEN/NOTIFY listener is split-aware as of shared@6.21.0,
   so it no longer needs it). Manual, founder-driven — run
   `docker/scripts/split-platform-db.sh` per
   `docs/runbook/db-source-target-cutover.md`. Executed in prod 2026-06-05.

`postgres-platform` is now **default-on** (part of the standard topology — an
empty, idle DB until cutover). The split stays dormant while
`SOURCE_/TARGET_DATABASE_URL` are unset; `assertDbSplit()` surfaces the dormant
single-failure-domain state in prod logs, and `GET /status` reports
`database.split.active`.

Reversed order silently writes chain data to the wrong DB. Never run `migrate`
against the chain instance via `docker compose run` without `--no-deps` (it can
recreate the chain volume).

## Post-cutover: each plane holds only its own tables (2026-06-05)

After the prod cutover the duplicated control-plane tables (the 30 TARGET tables
above) and the per-tenant `subgraph_<id>` schemas were **dropped from SOURCE** —
SOURCE now holds only chain + decoded + `kysely_migration*`. Platform is the
authoritative copy of all control-plane data (reclaimed ~1 GB).

The symmetric cleanup then ran: the 25 present-but-empty chain/decoded tables
were **dropped from TARGET** (gated on a verify-empty check; `RESTRICT`, no
control table references them). TARGET now holds only the 30 control tables +
`service_heartbeats` (a `both` table — indexer writes its row on SOURCE, the
subgraph-processor on TARGET) + `kysely_migration*`. Both planes are now clean,
so **both `onControlPlane` and `onChainPlane` are load-bearing** for new
migrations (an unwrapped control migration fails on SOURCE; an unwrapped chain
migration fails on TARGET).

### Split-aware migrate (resolved, shared@6.22.0)

`migrate.ts` still runs **every** migration on **every** database — it must, or
kysely throws "previously executed migration is missing" (each DB's
`kysely_migration` already records all 88). Instead it tags each target with a
plane role (`migrationTargets()` → `{url, role}` where role is `source` /
`target` / `both`) and sets it via `setMigrationRole()` before each pass; a
migration gates its DDL so control DDL no-ops on SOURCE (where those tables were
dropped) and chain DDL no-ops on TARGET. Single-DB / collapsed-split (dev / OSS /
CI) is role `'both'` — every helper runs, identical to pre-split behavior.

**Authoring a migration under the split** (`packages/shared/migrations/NNNN_*.ts`):

```ts
import { onChainPlane, onControlPlane } from "@secondlayer/shared/db";
export async function up(db: Kysely<unknown>) {
  await onControlPlane(() => sql`ALTER TABLE accounts ADD COLUMN …`.execute(db));
  await onChainPlane(() => sql`ALTER TABLE blocks ADD COLUMN …`.execute(db));
  // schema-wide / mixed (extensions, functions, enums): leave UNWRAPPED → both.
}
```

The canonical table→plane mapping is `TABLE_TO_DB` in
`packages/shared/src/db/table-plane.ts` (use it to decide which helper a table's
DDL belongs in). The 88 existing migrations are **unwrapped** → they run on both
and are recorded on both (harmless; never re-run). NEVER filter the migration
provider set per-DB — it trips kysely's missing-migration check. Per-tenant
`subgraph_<id>` schemas are dynamic DDL (not in `migrate.ts`).
