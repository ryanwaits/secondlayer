import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Gate-g Slice D: drop the retired hosted-control-plane tables. The metered
 * archive keeps accounts/sessions/magic_links/api_keys plus the credit +
 * Stripe + x402 tables; everything below belonged to plans, tenancy, hosted
 * console, usage metering, or the ghost-claim mint path — all deleted from the
 * codebase in the same change.
 *
 * `IF EXISTS` + `CASCADE` throughout so the migration is safe on databases
 * where some tables were never created (fresh self-host) or already removed.
 * CASCADE also detaches surviving FKs that point at a dropped table
 * (`subgraphs.project_id -> projects`) without touching the surviving column.
 *
 * `accounts.slug` (hosted-console public-directory handle) is the one
 * plan/slug-era account column with zero remaining code refs; `accounts.plan`
 * is still read by the subgraph deploy gates and stays.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		// Leaves first (FK-dependent), then roots — though CASCADE makes the
		// order non-load-bearing.
		await sql`DROP TABLE IF EXISTS tenant_usage_monthly CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS tenant_compute_addons CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS provisioning_audit_log CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS tenants CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS team_invitations CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS team_members CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS projects CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS usage_daily CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS usage_snapshots CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS account_insights CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS account_agent_runs CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS subgraph_usage_daily CASCADE`.execute(db);
		await sql`DROP TABLE IF EXISTS claim_tokens CASCADE`.execute(db);

		await sql`ALTER TABLE accounts DROP COLUMN IF EXISTS slug`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		// Irreversible by design: the dropped tables' data is gone and their
		// creating migrations (0001…0117) remain the historical schema record.
		// Restore the accounts column only, so a rollback of THIS migration
		// leaves a consistent accounts shape.
		await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS slug TEXT`.execute(
			db,
		);
	});
}
