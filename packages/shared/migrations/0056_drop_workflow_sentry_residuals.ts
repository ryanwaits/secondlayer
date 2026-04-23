import { type Kysely, sql } from "kysely";

/**
 * Drop all residual workflow + sentry tables after the product pivot.
 * Workflows/runner/sentries packages are gone; these tables have no writers.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS sentry_alerts CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS sentries CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_queue CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_steps CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_runs CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_ai_usage_daily CASCADE`.execute(db);

	await sql`DROP TRIGGER IF EXISTS tx_confirmed_trigger ON transactions`.execute(
		db,
	);
	await sql`DROP FUNCTION IF EXISTS tx_confirmed_notify() CASCADE`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	throw new Error("0056 is a one-way demolition; restore from backup");
}
