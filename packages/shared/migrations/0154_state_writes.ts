import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Opt-in node `state_writes` (`events_keys` `"state_writes"`): the exact MARF
 * writes a block committed, captured at the storage layer. Replaces the
 * evaluator-hooked `vm_events` var_set/map_* rows for verification: every
 * changed MARF leaf in a block must be named here.
 *
 * Key = `(block_height, ordinal)`, the node's per-block write order, so inserts
 * append at the right edge (same shape as `vm_events` after 0153). No other
 * index: nothing reads this table yet.
 *
 * `tx_index` is stored as delivered, not resolved to a `tx_id` FK. It is null
 * for block-level writes, and a `transactions` FK would cascade this table off
 * every transaction sweep (child-range repair, re-mine moves) the way
 * `vm_events.tx_id` does. Rows are height-scoped only: they follow `blocks` via
 * ON DELETE CASCADE, like every vm row sweep relies on (0133).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET LOCAL lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE IF NOT EXISTS state_writes (
				block_height BIGINT NOT NULL
					REFERENCES blocks (height) ON DELETE CASCADE,
				ordinal INTEGER NOT NULL,
				tx_index INTEGER NULL,
				key TEXT NOT NULL,
				value_hex TEXT NOT NULL,
				CONSTRAINT state_writes_pkey PRIMARY KEY (block_height, ordinal)
			)
		`.execute(db);

		await sql`
			CREATE TABLE IF NOT EXISTS state_writes_archive (
				archive_id BIGSERIAL PRIMARY KEY,
				id TEXT NOT NULL,
				block_height BIGINT NOT NULL,
				ordinal INTEGER NOT NULL,
				tx_index INTEGER NULL,
				key TEXT NOT NULL,
				value_hex TEXT NOT NULL,
				orphaned_block_hash TEXT,
				archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE INDEX IF NOT EXISTS state_writes_archive_height_idx
			ON state_writes_archive (block_height)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS state_writes_archive`.execute(db);
		await sql`DROP TABLE IF EXISTS state_writes`.execute(db);
	});
}
