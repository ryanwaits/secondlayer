import type { Kysely } from "kysely";
import { sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Unique `(block_height, tx_index)` on `transactions` (chain plane / SOURCE).
 *
 * `tx_index` is the transaction's position in its block, so one height holds
 * each position once. `persistBlock` replaces a height wholesale, so this
 * holds by construction; the index turns a violation (a tx left behind by a
 * reorg, an overlapping writer) into a loud write failure instead of two rows
 * Streams and Index order ambiguously.
 *
 * Same gating as 0101: a unique build cannot run over existing duplicates
 * (it would abort the migrate run) and an inline build over the full mainnet
 * table holds a blocking lock. So this NEVER builds inline on a large table:
 * it skips with a NOTICE, and the operator checks for duplicates first
 * (`findDuplicateTxIndexes`, or the SQL in the plan notes) and then builds it
 * `CREATE UNIQUE INDEX CONCURRENTLY transactions_height_tx_index_uniq ON
 * transactions (block_height, tx_index)`. Once the index exists this migration
 * no-ops on every later deploy. A small table (dev/test) gets it inline after
 * a cheap duplicate probe.
 */

const INLINE_BUILD_MAX_ROWS = 1_000_000;
const INDEX = "transactions_height_tx_index_uniq";

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		const skip = (reason: string) =>
			sql`DO $$ BEGIN RAISE NOTICE ${sql.lit(`${INDEX} SKIPPED: ${reason} — see migration 0199 header.`)}; END $$`.execute(
				db,
			);

		const existing = await sql<{ one: number }>`
			SELECT 1 AS one FROM pg_indexes WHERE indexname = ${INDEX}
		`.execute(db);
		if (existing.rows.length > 0) return;

		const est = await sql<{ rows: number }>`
			SELECT COALESCE(reltuples, -1)::bigint AS rows
			FROM pg_class WHERE oid = to_regclass('public.transactions')
		`.execute(db);
		const rowEstimate = Number(est.rows[0]?.rows ?? -1);
		if (rowEstimate > INLINE_BUILD_MAX_ROWS) {
			await skip(
				`transactions ~${rowEstimate} rows — check duplicates then CREATE UNIQUE INDEX CONCURRENTLY`,
			);
			return;
		}

		const probe = await sql<{ has_dupes: boolean }>`
			SELECT EXISTS (
				SELECT 1 FROM transactions
				GROUP BY block_height, tx_index HAVING count(*) > 1
			) AS has_dupes
		`.execute(db);
		if (probe.rows[0]?.has_dupes) {
			await skip("duplicate (block_height, tx_index) rows present");
			return;
		}

		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS transactions_height_tx_index_uniq
			ON transactions (block_height, tx_index)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP INDEX IF EXISTS transactions_height_tx_index_uniq`.execute(
			db,
		);
	});
}
