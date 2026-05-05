import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`
		ALTER TABLE blocks
			ADD COLUMN IF NOT EXISTS burn_block_hash text
	`.execute(db);

	await sql`
		CREATE TABLE IF NOT EXISTS chain_reorgs (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			detected_at timestamptz NOT NULL DEFAULT now(),
			fork_point_height bigint NOT NULL,
			old_index_block_hash text,
			new_index_block_hash text,
			orphaned_from_height bigint NOT NULL,
			orphaned_from_event_index integer NOT NULL,
			orphaned_to_height bigint NOT NULL,
			orphaned_to_event_index integer NOT NULL,
			new_canonical_height bigint NOT NULL,
			new_canonical_event_index integer NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`
		CREATE INDEX IF NOT EXISTS chain_reorgs_detected_at_idx
			ON chain_reorgs (detected_at)
	`.execute(db);
	await sql`
		CREATE INDEX IF NOT EXISTS chain_reorgs_orphaned_range_idx
			ON chain_reorgs (
				orphaned_from_height,
				orphaned_from_event_index,
				orphaned_to_height,
				orphaned_to_event_index
			)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS chain_reorgs`.execute(db);
	await sql`
		ALTER TABLE blocks
			DROP COLUMN IF EXISTS burn_block_hash
	`.execute(db);
}
