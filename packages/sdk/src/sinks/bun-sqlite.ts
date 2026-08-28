import type { Database } from "bun:sqlite";
import {
	DEFAULT_CHECKPOINT_TABLE,
	type SinkDriver,
	createSink,
	quoteIdent,
} from "./core.ts";
import type { ConsumerSink } from "./types.ts";

export interface BunSqliteSinkOptions {
	/** Checkpoint identity: the cursor row's primary key. */
	id: string;
	/** Rollback scope — every table the handler writes (see kyselySink). */
	tables: readonly string[];
	/** The block-height stamp column, present on every declared table
	 *  (first-use checked). Append-only projections only. */
	height: string;
	/** Checkpoint table name. Default `sl_consumer_checkpoints`. */
	checkpointTable?: string;
}

/**
 * A {@link ConsumerSink} over a `bun:sqlite` database — the zero-dependency,
 * zero-docker sink: one file on disk, nothing to install, nothing to run.
 * `ctx.tx` inside `onBatch` is the `Database` itself, inside an open
 * transaction.
 *
 * Batches commit under `BEGIN IMMEDIATE`, which takes SQLite's single write
 * lock up front — so the single-writer requirement (contract invariant #13)
 * is enforced by the file lock itself: a second writer process fails with
 * SQLITE_BUSY instead of interleaving.
 *
 * ```ts
 * import { Database } from "bun:sqlite";
 * const db = new Database("sales.db");
 * const sink = bunSqliteSink(db, { id: "sales", tables: ["sales"], height: "block_height" });
 * await index.contractCalls.consume({
 *   contractId: MARKETPLACE, functionName: "purchase-asset", fromHeight: 0,
 *   sink,
 *   onBatch: (calls, _env, ctx) => {
 *     for (const call of calls)
 *       ctx.tx.run("INSERT OR IGNORE INTO sales (tx_id, block_height) VALUES (?, ?)", [call.tx_id, call.block_height]);
 *   },
 * });
 * ```
 */
export function bunSqliteSink(
	db: Database,
	options: BunSqliteSinkOptions,
): ConsumerSink<Database> {
	const checkpointTable = options.checkpointTable ?? DEFAULT_CHECKPOINT_TABLE;
	const cp = quoteIdent(checkpointTable);

	const driver: SinkDriver<Database> = {
		// Manual BEGIN/COMMIT rather than db.transaction(): the handler is
		// async, and a sync transaction wrapper would COMMIT at the first
		// await — writes after it would land in autocommit, outside the
		// atomicity the contract requires.
		async transact(fn) {
			db.exec("BEGIN IMMEDIATE");
			try {
				const result = await fn(db);
				db.exec("COMMIT");
				return result;
			} catch (err) {
				db.exec("ROLLBACK");
				throw err;
			}
		},

		async ensureCheckpointStore() {
			db.exec(
				`CREATE TABLE IF NOT EXISTS ${cp} (id TEXT PRIMARY KEY, cursor TEXT NOT NULL)`,
			);
		},

		async readCursor() {
			const row = db
				.query<{ cursor: string }, [string]>(
					`SELECT cursor FROM ${cp} WHERE id = ?`,
				)
				.get(options.id);
			return row?.cursor ?? null;
		},

		async writeCursor(tx, cursor) {
			tx.query(
				`INSERT INTO ${cp} (id, cursor) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET cursor = excluded.cursor`,
			).run(options.id, cursor);
		},

		async clearCursor(tx) {
			tx.query(`DELETE FROM ${cp} WHERE id = ?`).run(options.id);
		},

		async deleteAtOrAbove(tx, table, height) {
			tx.query(
				`DELETE FROM ${quoteIdent(table)} WHERE ${quoteIdent(options.height)} >= ?`,
			).run(height);
		},

		async hasColumn(table, column) {
			const row = db
				.query("SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = ?")
				.get(table, column);
			return row !== null;
		},
	};

	return createSink(driver, {
		label: "bunSqliteSink",
		id: options.id,
		tables: options.tables,
		height: options.height,
		checkpointTable,
	});
}
