import { Database } from "bun:sqlite";
import { afterAll, describe, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { drizzleSink } from "../sinks/drizzle.ts";
import { attachSinkConformance } from "../sinks/testing.ts";

/**
 * drizzleSink (SQLite dialect) through the sink conformance kit — proves
 * the manual BEGIN IMMEDIATE path: a sync sqlite driver under
 * `db.transaction()` would COMMIT at the handler's first await, and the
 * torn-batch probe would catch the rows landing without the cursor.
 */

const rows = sqliteTable("drizzle_sqlite_conformance_rows", {
	key: text("key").primaryKey(),
	blockHeight: integer("block_height").notNull(),
});

const sqlite = new Database(":memory:");
const db = drizzle(sqlite);
const SINK_ID = "sink-conformance-drizzle-sqlite";

afterAll(() => {
	sqlite.close();
});

describe("drizzleSink conformance (bun:sqlite)", () => {
	attachSinkConformance(test, {
		makeSink: () =>
			drizzleSink(db, {
				id: SINK_ID,
				tables: [rows],
				height: "blockHeight",
			}),

		reset() {
			sqlite.exec("DROP TABLE IF EXISTS drizzle_sqlite_conformance_rows");
			sqlite.exec(
				"CREATE TABLE drizzle_sqlite_conformance_rows (key TEXT PRIMARY KEY, block_height INTEGER NOT NULL)",
			);
			sqlite.exec(
				"CREATE TABLE IF NOT EXISTS sl_consumer_checkpoints (id TEXT PRIMARY KEY, cursor TEXT NOT NULL)",
			);
			sqlite
				.query("DELETE FROM sl_consumer_checkpoints WHERE id = ?")
				.run(SINK_ID);
		},

		async insertRow(tx, height, key) {
			// Replay-safe, as the contract requires of real handlers.
			await tx
				.insert(rows)
				.values({ key, blockHeight: height })
				.onConflictDoNothing();
		},

		async readRows() {
			return db.select({ height: rows.blockHeight, key: rows.key }).from(rows);
		},

		async readCursor() {
			const row = sqlite
				.query<{ cursor: string }, [string]>(
					"SELECT cursor FROM sl_consumer_checkpoints WHERE id = ?",
				)
				.get(SINK_ID);
			return row?.cursor ?? null;
		},
	});
});
