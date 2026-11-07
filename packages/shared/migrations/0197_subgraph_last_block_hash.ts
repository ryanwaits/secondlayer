import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `subgraphs.last_processed_block_hash`: the hash of the block the cursor
 * (`last_processed_block`) points at. A catch-up compares it with the canonical
 * hash at that height, so a reorg whose NOTIFY the processor missed is still
 * found and rewound.
 *
 * The trigger keeps the pair honest. Any write that moves the cursor without
 * stating a hash (reindex start, anchor seeding, a halt) clears the hash,
 * because the old one no longer names the block at the new height. NULL means
 * "unknown" and the check skips it.
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
		if (!(await tableExists(db, "subgraphs"))) return;
		await sql`
			ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS last_processed_block_hash text
		`.execute(db);
		await sql`
			CREATE OR REPLACE FUNCTION subgraphs_clear_stale_block_hash() RETURNS trigger AS $$
			BEGIN
				IF NEW.last_processed_block IS DISTINCT FROM OLD.last_processed_block
					AND NEW.last_processed_block_hash IS NOT DISTINCT FROM OLD.last_processed_block_hash THEN
					NEW.last_processed_block_hash := NULL;
				END IF;
				RETURN NEW;
			END
			$$ LANGUAGE plpgsql
		`.execute(db);
		await sql`DROP TRIGGER IF EXISTS subgraphs_clear_stale_block_hash ON subgraphs`.execute(
			db,
		);
		await sql`
			CREATE TRIGGER subgraphs_clear_stale_block_hash
				BEFORE UPDATE OF last_processed_block ON subgraphs
				FOR EACH ROW EXECUTE FUNCTION subgraphs_clear_stale_block_hash()
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (!(await tableExists(db, "subgraphs"))) return;
		await sql`DROP TRIGGER IF EXISTS subgraphs_clear_stale_block_hash ON subgraphs`.execute(
			db,
		);
		await sql`DROP FUNCTION IF EXISTS subgraphs_clear_stale_block_hash()`.execute(
			db,
		);
		await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS last_processed_block_hash`.execute(
			db,
		);
	});
}
