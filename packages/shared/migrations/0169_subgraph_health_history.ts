import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Health history: lag/rows/storage columns on the (previously unwritten)
 * snapshot table, plus fingerprint-grouped handler errors (cap 50/subgraph,
 * enforced at write time).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraph_health_snapshots
				ADD COLUMN IF NOT EXISTS chain_tip bigint,
				ADD COLUMN IF NOT EXISTS rows_written_total bigint,
				ADD COLUMN IF NOT EXISTS storage_bytes bigint
		`.execute(db);

		await sql`
			CREATE TABLE IF NOT EXISTS subgraph_error_groups (
				id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				subgraph_name       text NOT NULL,
				fingerprint         text NOT NULL,
				source_name         text NOT NULL,
				event_type          text,
				message             text NOT NULL,
				frame               text,
				count               bigint NOT NULL DEFAULT 1,
				sample_tx_id        text,
				sample_block_height bigint,
				first_seen          timestamptz NOT NULL DEFAULT now(),
				last_seen           timestamptz NOT NULL DEFAULT now(),
				UNIQUE (subgraph_name, fingerprint)
			)
		`.execute(db);

		await sql`
			CREATE INDEX IF NOT EXISTS subgraph_error_groups_name_seen_idx
			ON subgraph_error_groups (subgraph_name, last_seen DESC)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS subgraph_error_groups`.execute(db);
		await sql`
			ALTER TABLE subgraph_health_snapshots
				DROP COLUMN IF EXISTS chain_tip,
				DROP COLUMN IF EXISTS rows_written_total,
				DROP COLUMN IF EXISTS storage_bytes
		`.execute(db);
	});
}
