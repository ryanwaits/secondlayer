import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Plans are fully retired: deploys are open on every instance and the only
 * metered surface is archive-data access (read credits). `accounts.plan` —
 * the last plan-machinery column, previously read by the subgraph deploy /
 * genesis / visibility / subscription gates — has zero remaining code refs,
 * so drop it.
 *
 * `IF EXISTS` so the migration is safe on databases where the column was
 * never created (fresh self-host) or already removed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`ALTER TABLE accounts DROP COLUMN IF EXISTS plan`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		// Restore the column with its pre-drop default ('none' since 0064).
		// Values are gone; every account comes back as plan 'none'.
		await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'none'`.execute(
			db,
		);
	});
}
