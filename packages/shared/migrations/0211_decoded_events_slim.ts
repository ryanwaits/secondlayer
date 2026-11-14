import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Slim `decoded_events` (chain plane / SOURCE).
 *
 * Drops what no query uses: the `(tx_id, event_index)` and bare `event_type`
 * indexes (every event_type read is served by a composite), and the
 * `source_cursor` (always equal to `cursor`) and `microblock_hash` (never
 * written) columns. Both are metadata-only on any table size; the deploy
 * stops lock holders before migrating.
 *
 * The contract/sender/recipient composites become partial on their own
 * column being NOT NULL: equality and IN filters imply it, so every reader
 * still uses them, and rows without the column (prints have no sender) stop
 * costing index space. Rebuilding them is a full index build, so it only
 * runs inline while the table is small (fresh installs, and the v2 database
 * before its decoder rebuild). On a large table it skips with a NOTICE and
 * the old full indexes stay until the table is rebuilt.
 *
 * `payload` new values compress with lz4 (metadata-only; existing rows keep
 * pglz until rewritten).
 */

export const INLINE_BUILD_MAX_BYTES = 1024 ** 3; // 1 GiB
// column -> index name (the contract index predates the `<column>_` naming)
const FILTER_INDEXES = [
	["contract_id", "decoded_events_contract_height_event_idx"],
	["sender", "decoded_events_sender_height_event_idx"],
	["recipient", "decoded_events_recipient_height_event_idx"],
] as const;

export function shouldRebuildFilterIndexes(bytes: number): boolean {
	return bytes <= INLINE_BUILD_MAX_BYTES;
}

async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${table}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		if (!(await tableExists(db, "decoded_events"))) return;

		await sql`DROP INDEX IF EXISTS decoded_events_tx_id_event_index_idx`.execute(
			db,
		);
		await sql`DROP INDEX IF EXISTS decoded_events_event_type_idx`.execute(db);
		await sql`
			ALTER TABLE decoded_events
				DROP COLUMN IF EXISTS source_cursor,
				DROP COLUMN IF EXISTS microblock_hash
		`.execute(db);
		await sql`ALTER TABLE decoded_events ALTER COLUMN payload SET COMPRESSION lz4`.execute(
			db,
		);

		const size = await sql<{ bytes: string }>`
			SELECT pg_total_relation_size('decoded_events')::text AS bytes
		`.execute(db);
		const bytes = Number(size.rows[0]?.bytes ?? 0);
		if (!shouldRebuildFilterIndexes(bytes)) {
			await sql`DO $$ BEGIN RAISE NOTICE ${sql.lit(
				`decoded_events partial filter indexes SKIPPED: table is ${bytes} bytes — they become partial when the table is rebuilt (see this migration's header).`,
			)}; END $$`.execute(db);
			return;
		}
		for (const [column, name] of FILTER_INDEXES) {
			const index = sql.ref(name);
			const col = sql.ref(column);
			await sql`DROP INDEX IF EXISTS ${index}`.execute(db);
			await sql`
				CREATE INDEX ${index} ON decoded_events (${col}, block_height, event_index)
				WHERE ${col} IS NOT NULL
			`.execute(db);
		}
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		if (!(await tableExists(db, "decoded_events"))) return;
		await sql`
			ALTER TABLE decoded_events
				ADD COLUMN IF NOT EXISTS source_cursor TEXT,
				ADD COLUMN IF NOT EXISTS microblock_hash TEXT
		`.execute(db);
		await sql`UPDATE decoded_events SET source_cursor = cursor WHERE source_cursor IS NULL`.execute(
			db,
		);
		await sql`ALTER TABLE decoded_events ALTER COLUMN source_cursor SET NOT NULL`.execute(
			db,
		);
		await sql`ALTER TABLE decoded_events ALTER COLUMN payload SET COMPRESSION pglz`.execute(
			db,
		);
		await sql`CREATE INDEX IF NOT EXISTS decoded_events_event_type_idx ON decoded_events (event_type)`.execute(
			db,
		);
		await sql`CREATE INDEX IF NOT EXISTS decoded_events_tx_id_event_index_idx ON decoded_events (tx_id, event_index)`.execute(
			db,
		);
		for (const [column, name] of FILTER_INDEXES) {
			const index = sql.ref(name);
			await sql`DROP INDEX IF EXISTS ${index}`.execute(db);
			await sql`CREATE INDEX ${index} ON decoded_events (${sql.ref(column)}, block_height, event_index)`.execute(
				db,
			);
		}
	});
}
