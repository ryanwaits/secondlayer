import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Drop raw-table indexes another index already covers (chain plane / SOURCE).
 *
 * - `events_type_idx`: no query filters `events` by type alone; every type
 *   predicate rides a block_height range (`events_height_type_idx`).
 * - `events_block_height_idx`: `events_height_type_idx` and
 *   `events_logical_id_uniq` both lead with block_height.
 * - `transactions_block_height_idx`: `transactions_height_tx_index_uniq`
 *   leads with block_height. That one is built by hand on large tables (0199
 *   skips them), so this drop only runs where it exists and is valid.
 *
 * Each drop is guarded on its covering index being present and valid; a
 * skipped drop raises a NOTICE. Plain DROP INDEX is metadata-only; the deploy
 * stops lock holders before migrating.
 */

async function validIndex(db: Kysely<unknown>, name: string): Promise<boolean> {
	const { rows } = await sql<{ ok: boolean }>`
		SELECT i.indisvalid AND i.indisready AS ok
		FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
		WHERE c.relname = ${name}
	`.execute(db);
	return rows[0]?.ok === true;
}

async function dropIfCovered(
	db: Kysely<unknown>,
	index: string,
	coveredBy: readonly string[],
): Promise<void> {
	for (const cover of coveredBy) {
		if (await validIndex(db, cover)) {
			await sql`DROP INDEX IF EXISTS ${sql.ref(index)}`.execute(db);
			return;
		}
	}
	await sql`DO $$ BEGIN RAISE NOTICE ${sql.lit(
		`${index} kept: none of ${coveredBy.join(", ")} exists and is valid — rerun this drop by hand once it does.`,
	)}; END $$`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP INDEX IF EXISTS events_type_idx`.execute(db);
		await dropIfCovered(db, "events_block_height_idx", [
			"events_height_type_idx",
			"events_logical_id_uniq",
		]);
		await dropIfCovered(db, "transactions_block_height_idx", [
			"transactions_height_tx_index_uniq",
		]);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		// Inline builds: fine on dev/test; on a large table build them CONCURRENTLY by hand first.
		await sql`CREATE INDEX IF NOT EXISTS events_type_idx ON events (type)`.execute(
			db,
		);
		await sql`CREATE INDEX IF NOT EXISTS events_block_height_idx ON events (block_height)`.execute(
			db,
		);
		await sql`CREATE INDEX IF NOT EXISTS transactions_block_height_idx ON transactions (block_height)`.execute(
			db,
		);
	});
}
