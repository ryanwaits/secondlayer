import type { Kysely } from "kysely";
import { sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * `vm_events (contract, type, block_height, ordinal)` (chain plane / SOURCE).
 *
 * Contract state reads (`/v1/index/events`, Streams `clock=vm`) filter on
 * `data->>'contract_identifier'`. The only other index serving a type + height
 * read is `vm_events_type_height_ordinal_idx`, so one contract over a long
 * range walks every row of that type to find a handful. Leading with the
 * contract, then type, gives an ordered scan on `(block_height, ordinal)` in
 * both directions. Every event type carries the key, so the index is not
 * partial. Same fix as 0073 for prints.
 *
 * An inline build over the full mainnet table holds a blocking lock, and
 * migrations run in a transaction so `CONCURRENTLY` cannot run here. So this
 * NEVER builds inline on a large table: it skips with a NOTICE and the
 * operator builds it, off-peak, with `SET statement_timeout = 0`:
 * `CREATE INDEX CONCURRENTLY vm_events_contract_type_height_idx ON vm_events
 * ((data->>'contract_identifier'), type, block_height, ordinal);`
 * If it fails, `DROP INDEX CONCURRENTLY` the invalid index and rerun. Once the
 * index exists this migration no-ops on every later deploy. A small table
 * (dev/test) gets it inline.
 */

const INLINE_BUILD_MAX_ROWS = 1_000_000;
const INDEX = "vm_events_contract_type_height_idx";

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		const existing = await sql<{ one: number }>`
			SELECT 1 AS one FROM pg_indexes WHERE indexname = ${INDEX}
		`.execute(db);
		if (existing.rows.length > 0) return;

		const est = await sql<{ rows: number }>`
			SELECT COALESCE(reltuples, -1)::bigint AS rows
			FROM pg_class WHERE oid = to_regclass('public.vm_events')
		`.execute(db);
		const rowEstimate = Number(est.rows[0]?.rows ?? -1);
		if (rowEstimate > INLINE_BUILD_MAX_ROWS) {
			await sql`DO $$ BEGIN RAISE NOTICE ${sql.lit(`${INDEX} SKIPPED: vm_events ~${rowEstimate} rows — build CONCURRENTLY, see migration 0218 header.`)}; END $$`.execute(
				db,
			);
			return;
		}

		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS vm_events_contract_type_height_idx
			ON vm_events ((data->>'contract_identifier'), type, block_height, ordinal)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP INDEX IF EXISTS vm_events_contract_type_height_idx`.execute(
			db,
		);
	});
}
