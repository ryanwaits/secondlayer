import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Billing reads filter `usage_ledger` by `unit = 'rows.delivered'` (or
 * `memory.gb_hour`) per account over a time window. The existing
 * `(account_id, occurred_at)` index reads every unit's rows and discards
 * most of them, so `(account_id, unit, occurred_at)` lets those reads touch
 * only the matching rows. The old index stays: unit-less month and burn
 * reads still use it.
 *
 * `api_failed_requests` is filtered by `account_id` + `created_at` but only
 * indexed on `created_at`.
 *
 * On prod the operator pre-creates both indexes CONCURRENTLY with these
 * exact names before deploy, so IF NOT EXISTS makes this a no-op there and
 * a cheap build on fresh/dev databases.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE INDEX IF NOT EXISTS usage_ledger_account_unit_occurred_at_idx
				ON usage_ledger (account_id, unit, occurred_at)
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS api_failed_requests_account_created_at_idx
				ON api_failed_requests (account_id, created_at)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP INDEX IF EXISTS usage_ledger_account_unit_occurred_at_idx`.execute(
			db,
		);
		await sql`DROP INDEX IF EXISTS api_failed_requests_account_created_at_idx`.execute(
			db,
		);
	});
}
