import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Subgraph lifecycle columns.
 *
 * - `status` gets a CHECK mirroring `SUBGRAPH_STATES` (schemas/subgraphs.ts).
 *   `paused` and `deploying` were never written, so no row can carry them.
 * - `billing_paused_at` / `billing_paused_code` replace the `billing_paused:`
 *   prefix that used to live in `last_error`, where the next processed block
 *   clobbered it. Both set or both null.
 * - `expires_at` (paid-deploy expiry) had no reader and no writer: dropped.
 *
 * Skipped where `subgraphs` is absent (the chain DB under the source/target split).
 */

const CHECKS = [
	["subgraphs_status_check", "status IN ('active', 'reindexing', 'error')"],
	[
		"subgraphs_billing_paused_check",
		"(billing_paused_at IS NULL) = (billing_paused_code IS NULL)",
	],
] as const;

async function subgraphsExist(db: Kysely<unknown>) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass('public.subgraphs') IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (!(await subgraphsExist(db))) return;
		await sql`
			ALTER TABLE subgraphs
				ADD COLUMN IF NOT EXISTS billing_paused_at timestamptz,
				ADD COLUMN IF NOT EXISTS billing_paused_code text
		`.execute(db);
		// Existing pauses carried the code in last_error; move them over.
		await sql`
			UPDATE subgraphs
			SET billing_paused_at = COALESCE(last_error_at, now()),
				billing_paused_code = substr(last_error, length('billing_paused: ') + 1),
				last_error = NULL,
				last_error_at = NULL
			WHERE last_error LIKE 'billing_paused: %'
		`.execute(db);
		await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS expires_at`.execute(
			db,
		);
		for (const [name, expression] of CHECKS) {
			await sql`ALTER TABLE subgraphs DROP CONSTRAINT IF EXISTS ${sql.id(name)}`.execute(
				db,
			);
			await sql`
				ALTER TABLE subgraphs
					ADD CONSTRAINT ${sql.id(name)} CHECK (${sql.raw(expression)}) NOT VALID
			`.execute(db);
			await sql`ALTER TABLE subgraphs VALIDATE CONSTRAINT ${sql.id(name)}`.execute(
				db,
			);
		}
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		if (!(await subgraphsExist(db))) return;
		for (const [name] of CHECKS) {
			await sql`ALTER TABLE subgraphs DROP CONSTRAINT IF EXISTS ${sql.id(name)}`.execute(
				db,
			);
		}
		await sql`
			ALTER TABLE subgraphs
				ADD COLUMN IF NOT EXISTS expires_at timestamptz,
				DROP COLUMN IF EXISTS billing_paused_at,
				DROP COLUMN IF EXISTS billing_paused_code
		`.execute(db);
	});
}
