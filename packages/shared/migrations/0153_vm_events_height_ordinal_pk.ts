import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * `vm_events` primary key = `(block_height, ordinal)`, the row's logical id.
 *
 * The random `id UUID` key put every insert on a random page of a 5 GB index,
 * and that random read was most of the indexer's write time on a full sync.
 * The logical key is append-ordered, so inserts touch the right edge only.
 *
 * Catalog-only on any size table: `vm_events_logical_id_uniq` already holds
 * the key, so it is promoted (`ADD PRIMARY KEY USING INDEX`, no rebuild, no
 * NOT NULL scan: both columns are already NOT NULL) and `DROP COLUMN` only
 * marks the column dropped. The ACCESS EXCLUSIVE lock is held for the catalog
 * swap, not a table pass. Only a DB missing the unique index builds it inline.
 *
 * Indexes dropped:
 *   - `vm_events_block_height_idx`: a prefix of the new key.
 *   - `vm_events_type_height_idx`: a prefix of
 *     `vm_events_type_height_ordinal_idx`, which the Index and Streams vm
 *     readers seek (`type`, height range, `ORDER BY block_height, ordinal`).
 * Kept: `vm_events_tx_id_idx`. No reader filters vm_events by tx_id, but
 * `vm_events_tx_id_fkey` cascades from `transactions`; without it every
 * transaction delete (reorg replace, repair) seq-scans vm_events.
 *
 * `vm_events_archive.id` stays TEXT; archives now write
 * `block_height:ordinal` there (see `archiveOrphanedHeight`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET LOCAL lock_timeout = '30s'`.execute(db);
		await sql`SET LOCAL statement_timeout = 0`.execute(db);

		const hasIdColumn = await sql<{ one: number }>`
			SELECT 1 AS one FROM information_schema.columns
			 WHERE table_schema = current_schema()
			   AND table_name = 'vm_events' AND column_name = 'id'
		`.execute(db);
		if (hasIdColumn.rows.length === 0) return;

		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS vm_events_logical_id_uniq
			ON vm_events (block_height, ordinal)
		`.execute(db);
		await sql`ALTER TABLE vm_events DROP CONSTRAINT vm_events_pkey`.execute(db);
		await sql`
			ALTER TABLE vm_events
				ADD CONSTRAINT vm_events_pkey PRIMARY KEY
				USING INDEX vm_events_logical_id_uniq
		`.execute(db);
		await sql`ALTER TABLE vm_events DROP COLUMN id`.execute(db);
		await sql`DROP INDEX IF EXISTS vm_events_block_height_idx`.execute(db);
		await sql`DROP INDEX IF EXISTS vm_events_type_height_idx`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET LOCAL lock_timeout = '30s'`.execute(db);
		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS vm_events_type_height_idx
			ON vm_events (type, block_height)
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS vm_events_block_height_idx
			ON vm_events (block_height)
		`.execute(db);
		await sql`
			ALTER TABLE vm_events
				ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid()
		`.execute(db);
		await sql`ALTER TABLE vm_events DROP CONSTRAINT vm_events_pkey`.execute(db);
		await sql`ALTER TABLE vm_events ADD PRIMARY KEY (id)`.execute(db);
		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS vm_events_logical_id_uniq
			ON vm_events (block_height, ordinal)
		`.execute(db);
	});
}
