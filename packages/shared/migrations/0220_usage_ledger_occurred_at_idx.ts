import type { Kysely } from "kysely";
import { sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `usage_ledger (occurred_at, account_id)` (control plane / TARGET).
 *
 * Cron scans filter the ledger by time across every account
 * (`accountsToCheckForBalanceAlerts`, `listActiveAccountIds`). Every other
 * index on the table leads with `account_id`, so each run sequential-scans a
 * ledger that is never purged. Leading with `occurred_at` turns the scan into
 * a range read, and carrying `account_id` makes it index-only.
 *
 * Migrations run in a transaction so `CONCURRENTLY` cannot run here. A large
 * table skips with a NOTICE and the operator builds it off-peak with
 * `SET statement_timeout = 0`:
 * `CREATE INDEX CONCURRENTLY usage_ledger_occurred_at_idx ON usage_ledger (occurred_at, account_id);`
 * If it fails, `DROP INDEX CONCURRENTLY` the invalid index and rerun. Once the
 * index exists this migration no-ops on every later deploy. A small table
 * (dev/test) gets it inline.
 */

const INLINE_BUILD_MAX_ROWS = 5_000_000;
const INDEX = "usage_ledger_occurred_at_idx";

export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		const existing = await sql<{ one: number }>`
			SELECT 1 AS one FROM pg_indexes WHERE indexname = ${INDEX}
		`.execute(db);
		if (existing.rows.length > 0) return;

		const est = await sql<{ rows: number }>`
			SELECT COALESCE(reltuples, -1)::bigint AS rows
			FROM pg_class WHERE oid = to_regclass('public.usage_ledger')
		`.execute(db);
		const rowEstimate = Number(est.rows[0]?.rows ?? -1);
		if (rowEstimate > INLINE_BUILD_MAX_ROWS) {
			await sql`DO $$ BEGIN RAISE NOTICE ${sql.lit(`${INDEX} SKIPPED: usage_ledger ~${rowEstimate} rows — build CONCURRENTLY, see migration 0220 header.`)}; END $$`.execute(
				db,
			);
			return;
		}

		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS usage_ledger_occurred_at_idx
			ON usage_ledger (occurred_at, account_id)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP INDEX IF EXISTS usage_ledger_occurred_at_idx`.execute(db);
	});
}
