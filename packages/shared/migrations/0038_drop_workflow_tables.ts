import { type Kysely, sql } from "kysely";

/**
 * Drops all workflow-related tables + the `tx_confirmed_notify` trigger.
 *
 * Workflows are going on the back burner while we ship dedicated-hosted
 * subgraphs. We've learned enough from building the subgraph tenant model
 * that reviving workflows later can follow the same dedicated-per-tenant
 * pattern with a fresh schema designed for that architecture — no reason
 * to keep dormant tables on the shared platform DB.
 *
 * Tables dropped (in FK-safe order via CASCADE):
 *   workflow_steps, workflow_runs, workflow_queue, workflow_schedules,
 *   workflow_cursors, workflow_signer_secrets, workflow_budgets,
 *   workflow_definitions
 *
 * Also drops `tx_confirmed_notify` — nobody listens on `tx:confirmed` now
 * that workflow-runner is unmounted. The trigger fires on every
 * transactions insert (indexer hot path), so leaving it is wasted work.
 *
 * `down` is intentionally a no-op. When workflows revive, they get fresh
 * migrations designed for the tenant model — don't try to reverse into the
 * old platform-shared schema.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`DROP TRIGGER IF EXISTS tx_confirmed_notify ON transactions`.execute(
		db,
	);
	await sql`DROP FUNCTION IF EXISTS notify_tx_confirmed()`.execute(db);

	await sql`DROP TABLE IF EXISTS workflow_steps CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_runs CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_queue CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_schedules CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_cursors CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_signer_secrets CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_budgets CASCADE`.execute(db);
	await sql`DROP TABLE IF EXISTS workflow_definitions CASCADE`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// Intentional no-op. Revived workflows will use fresh migrations sized
	// for the tenant-per-customer model.
}
