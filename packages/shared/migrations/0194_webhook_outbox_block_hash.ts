import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Chain apply rows record the block they were emitted for, and a reorg
 * rollback records when it recalled a delivered row.
 *
 *  - `block_hash`: the hash of the block the apply row came from. Null on
 *    rows written before this column existed; the reorg handler reads
 *    `payload->>'block_hash'` for those, so no backfill is needed.
 *  - `rolled_back_at`: set on a `delivered` apply row once a rollback has
 *    snapshotted it, so a reorg that arrives as several `chain_reorgs` rows
 *    recalls each orphaned event once.
 *
 * Skipped when the table is absent (not every database carries it).
 */
async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (!(await tableExists(db, "webhook_outbox"))) return;
		await sql`
			ALTER TABLE webhook_outbox
				ADD COLUMN IF NOT EXISTS block_hash text,
				ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (!(await tableExists(db, "webhook_outbox"))) return;
		await sql`
			ALTER TABLE webhook_outbox
				DROP COLUMN IF EXISTS block_hash,
				DROP COLUMN IF EXISTS rolled_back_at
		`.execute(db);
	});
}
