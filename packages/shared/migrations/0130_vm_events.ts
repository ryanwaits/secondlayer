import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Opt-in node vm_events (`"storage"` / `"contract_calls"`). Second clock:
 * `vm_event_index` is dense across the block and is never mixed into
 * `events.event_index` / Streams 1.0. `"*"` payloads omit the field; this
 * table stays empty until a collecting node is wired.
 *
 * Stored `type` uses Secondlayer names (nested_contract_call, var_set,
 * map_set, map_insert, map_delete) — not the node's `*_event` labels, and
 * not outer `contract_call`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE IF NOT EXISTS vm_events (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tx_id TEXT NOT NULL REFERENCES transactions (tx_id),
				block_height BIGINT NOT NULL REFERENCES blocks (height),
				vm_event_index INTEGER NOT NULL,
				type TEXT NOT NULL,
				data JSONB NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT vm_events_type_check CHECK (type IN (
					'nested_contract_call',
					'var_set',
					'map_set',
					'map_insert',
					'map_delete'
				))
			)
		`.execute(db);

		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS vm_events_logical_id_uniq
			ON vm_events (block_height, vm_event_index)
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS vm_events_block_height_idx
			ON vm_events (block_height)
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS vm_events_tx_id_idx
			ON vm_events (tx_id)
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS vm_events_type_height_idx
			ON vm_events (type, block_height)
		`.execute(db);

		await sql`
			CREATE TABLE IF NOT EXISTS vm_events_archive (
				archive_id BIGSERIAL PRIMARY KEY,
				id TEXT NOT NULL,
				tx_id TEXT NOT NULL,
				block_height BIGINT NOT NULL,
				vm_event_index INTEGER NOT NULL,
				type TEXT NOT NULL,
				data JSONB,
				created_at TIMESTAMPTZ NOT NULL,
				orphaned_block_hash TEXT,
				archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE INDEX IF NOT EXISTS vm_events_archive_height_idx
			ON vm_events_archive (block_height)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS vm_events_archive`.execute(db);
		await sql`DROP TABLE IF EXISTS vm_events`.execute(db);
	});
}
