import type { Kysely } from "kysely";
import { sql } from "kysely";
import { LIVE_REWRITE_SPECS, swapLiveRewrite } from "../src/db/live-rewrite.ts";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * `vm_events` keys a row to its transaction by `(block_height, tx_index)`
 * instead of a 66-character `tx_id` (chain plane / SOURCE). The table also
 * loses `created_at` and the `tx_id` index and foreign key. A vm row is owned
 * by its height, like `state_writes`: a re-mined transaction moves with its
 * `transactions` row and never touches vm rows at the old height.
 *
 * Three paths, tried in order:
 * 1. No `tx_id` column: already migrated, return.
 * 2. `vm_events_next` exists: the operator filled it with
 *    `packages/indexer/src/live-rewrite.ts --table vm_events` (prepare, copy,
 *    index, verify, preflight). Deploy stops every writer before migrations
 *    run, so this swaps the tables in one transaction and keeps the old one as
 *    `vm_events_old`. `swapLiveRewrite` throws with every reason if the copy is
 *    not ready, which aborts the deploy before anything changes.
 * 3. Small table (about 1M rows or fewer: dev, CI, testnet, self-host on a
 *    stock node): rewrite in place. A vm row whose transaction is not found at
 *    its height aborts the migration; nothing is deleted.
 * Any other large table raises and names the tool to run first.
 */

const INLINE_REWRITE_MAX_ROWS = 1_000_000;

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		const column = await sql<{ one: number }>`
			SELECT 1 AS one FROM information_schema.columns
			 WHERE table_schema = current_schema()
			   AND table_name = 'vm_events' AND column_name = 'tx_id'
		`.execute(db);
		if (column.rows.length === 0) return;

		const next = await sql<{ ok: boolean }>`
			SELECT to_regclass('vm_events_next') IS NOT NULL AS ok
		`.execute(db);
		if (next.rows[0]?.ok) {
			await swapLiveRewrite(db, LIVE_REWRITE_SPECS.vm_events);
			return;
		}

		const est = await sql<{ rows: number }>`
			SELECT COALESCE(reltuples, -1)::bigint AS rows
			FROM pg_class WHERE oid = to_regclass('vm_events')
		`.execute(db);
		const rowEstimate = Number(est.rows[0]?.rows ?? -1);
		if (rowEstimate > INLINE_REWRITE_MAX_ROWS) {
			throw new Error(
				`vm_events has ~${rowEstimate} rows: run packages/indexer/src/live-rewrite.ts --table vm_events (prepare, copy, index, verify, preflight) before deploying this migration`,
			);
		}

		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`ALTER TABLE vm_events ADD COLUMN tx_index INTEGER`.execute(db);
		await sql`
			UPDATE vm_events vm SET tx_index = t.tx_index
			  FROM transactions t
			 WHERE t.tx_id = vm.tx_id AND t.block_height = vm.block_height
		`.execute(db);
		const orphaned = await sql<{ n: number }>`
			SELECT count(*)::int AS n FROM vm_events WHERE tx_index IS NULL
		`.execute(db);
		const orphanCount = orphaned.rows[0]?.n ?? 0;
		if (orphanCount > 0) {
			throw new Error(
				`vm_events: ${orphanCount} rows have no transaction at their height; refusing to drop tx_id`,
			);
		}
		await sql`ALTER TABLE vm_events ALTER COLUMN tx_index SET NOT NULL`.execute(
			db,
		);
		await sql`ALTER TABLE vm_events DROP CONSTRAINT IF EXISTS vm_events_tx_id_fkey`.execute(
			db,
		);
		await sql`DROP INDEX IF EXISTS vm_events_tx_id_idx`.execute(db);
		await sql`ALTER TABLE vm_events DROP COLUMN tx_id, DROP COLUMN created_at`.execute(
			db,
		);
	});
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	throw new Error("0225_vm_events_tx_index is not reversible");
}
