import { Database } from "bun:sqlite";
import { afterAll, describe, test } from "bun:test";
import { bunSqliteSink } from "../sinks/bun-sqlite.ts";
import { attachSinkConformance } from "../sinks/testing.ts";

/**
 * bunSqliteSink through the sink conformance kit — no Postgres, no docker,
 * no dependencies: this suite runs everywhere, which is the point of the
 * sink it proves.
 */

const db = new Database(":memory:");
const SINK_ID = "sink-conformance-sqlite";

afterAll(() => {
	db.close();
});

describe("bunSqliteSink conformance", () => {
	attachSinkConformance(test, {
		makeSink: () =>
			bunSqliteSink(db, {
				id: SINK_ID,
				tables: ["sink_conformance_rows"],
				height: "height",
			}),

		reset() {
			db.exec("DROP TABLE IF EXISTS sink_conformance_rows");
			db.exec(
				"CREATE TABLE sink_conformance_rows (key TEXT PRIMARY KEY, height INTEGER NOT NULL)",
			);
			db.exec(
				"CREATE TABLE IF NOT EXISTS sl_consumer_checkpoints (id TEXT PRIMARY KEY, cursor TEXT NOT NULL)",
			);
			db.query("DELETE FROM sl_consumer_checkpoints WHERE id = ?").run(SINK_ID);
		},

		insertRow(tx, height, key) {
			// Replay-safe, as the contract requires of real handlers.
			tx.query(
				"INSERT OR IGNORE INTO sink_conformance_rows (key, height) VALUES (?, ?)",
			).run(key, height);
		},

		async readRows() {
			return db
				.query<{ height: number; key: string }, []>(
					"SELECT height, key FROM sink_conformance_rows",
				)
				.all();
		},

		async readCursor() {
			const row = db
				.query<{ cursor: string }, [string]>(
					"SELECT cursor FROM sl_consumer_checkpoints WHERE id = ?",
				)
				.get(SINK_ID);
			return row?.cursor ?? null;
		},
	});
});
