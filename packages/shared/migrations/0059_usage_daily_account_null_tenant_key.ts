import { type Kysely, sql } from "kysely";

/**
 * Keep account-level usage rows conflict-safe after 0047 introduced nullable
 * tenant_id for future per-tenant metering.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE UNIQUE INDEX IF NOT EXISTS usage_daily_account_null_tenant_key
			ON usage_daily (account_id, date)
			WHERE tenant_id IS NULL
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		DROP INDEX IF EXISTS usage_daily_account_null_tenant_key
	`.execute(db);
}
