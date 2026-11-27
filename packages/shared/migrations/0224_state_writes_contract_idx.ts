import type { Kysely } from "kysely";
import { sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * `state_writes ((split_part(key, '::', 2)), block_height, ordinal)`
 * `WHERE starts_with(key, 'vm::')` (chain plane / SOURCE).
 *
 * `GET /v1/index/state-writes?contract_id=...` with a wide height window
 * otherwise scans the `(block_height, ordinal)` primary key across every
 * contract's MARF writes. Leading with `split_part(key, '::', 2)` gives an
 * ordered scan on `(block_height, ordinal)` per contract.
 *
 * An inline build over a large table holds a blocking lock, and migrations run
 * in a transaction so `CONCURRENTLY` cannot run here. On tables over 1M rows
 * this skips with a NOTICE and the operator builds it off-peak with
 * `SET statement_timeout = 0`:
 * `CREATE INDEX CONCURRENTLY state_writes_contract_height_idx ON state_writes ((split_part(key, '::', 2)), block_height, ordinal) WHERE starts_with(key, 'vm::');`
 */

const INLINE_BUILD_MAX_ROWS = 1_000_000;
const INDEX = "state_writes_contract_height_idx";
const CONCURRENT_DDL =
	"CREATE INDEX CONCURRENTLY state_writes_contract_height_idx ON state_writes ((split_part(key, '::', 2)), block_height, ordinal) WHERE starts_with(key, 'vm::');";

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		const existing = await sql<{ one: number }>`
			SELECT 1 AS one FROM pg_indexes WHERE indexname = ${INDEX}
		`.execute(db);
		if (existing.rows.length > 0) return;

		const est = await sql<{ rows: number }>`
			SELECT COALESCE(reltuples, -1)::bigint AS rows
			FROM pg_class WHERE oid = to_regclass('public.state_writes')
		`.execute(db);
		const rowEstimate = Number(est.rows[0]?.rows ?? -1);
		if (rowEstimate > INLINE_BUILD_MAX_ROWS) {
			await sql`DO $$ BEGIN RAISE NOTICE ${sql.lit(`${INDEX} SKIPPED: state_writes ~${rowEstimate} rows — run off-peak: ${CONCURRENT_DDL}`)}; END $$`.execute(
				db,
			);
			return;
		}

		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS state_writes_contract_height_idx
			ON state_writes ((split_part(key, '::', 2)), block_height, ordinal)
			WHERE starts_with(key, 'vm::')
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP INDEX IF EXISTS state_writes_contract_height_idx`.execute(
			db,
		);
	});
}
