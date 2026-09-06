import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
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

describe("bunSqliteSink onRollback", () => {
	const ID = "sink-fold-sqlite";

	test("inverts a fold before the fact-table delete; re-apply is a no-op", async () => {
		db.exec("DROP TABLE IF EXISTS sink_fold_transfers");
		db.exec("DROP TABLE IF EXISTS sink_fold_balances");
		db.exec(
			"CREATE TABLE sink_fold_transfers (cursor TEXT PRIMARY KEY, height INTEGER NOT NULL, holder TEXT NOT NULL, amount INTEGER NOT NULL)",
		);
		db.exec(
			"CREATE TABLE sink_fold_balances (holder TEXT PRIMARY KEY, amount INTEGER NOT NULL)",
		);
		db.exec(
			"CREATE TABLE IF NOT EXISTS sl_consumer_checkpoints (id TEXT PRIMARY KEY, cursor TEXT NOT NULL)",
		);
		db.query("DELETE FROM sl_consumer_checkpoints WHERE id = ?").run(ID);

		const sink = bunSqliteSink(db, {
			id: ID,
			tables: ["sink_fold_transfers"],
			height: "height",
			onRollback: (tx, { forkPointHeight }) => {
				const doomed = tx
					.query<{ holder: string; amount: number }, [number]>(
						"SELECT holder, amount FROM sink_fold_transfers WHERE height >= ?",
					)
					.all(forkPointHeight);
				for (const row of doomed) {
					tx.query(
						"UPDATE sink_fold_balances SET amount = amount - ? WHERE holder = ?",
					).run(row.amount, row.holder);
				}
			},
		});
		await sink.loadCursor();
		await sink.commitBatch("12:0", (tx) => {
			tx.query(
				"INSERT INTO sink_fold_transfers (cursor, height, holder, amount) VALUES (?, ?, ?, ?)",
			).run("10:0", 10, "ALICE", 5);
			tx.query(
				"INSERT INTO sink_fold_transfers (cursor, height, holder, amount) VALUES (?, ?, ?, ?)",
			).run("12:0", 12, "ALICE", 3);
			tx.query(
				"INSERT INTO sink_fold_balances (holder, amount) VALUES (?, ?)",
			).run("ALICE", 8);
		});

		await sink.rollback(12, "11:2147483647");
		expect(
			db
				.query<{ holder: string; amount: number }, []>(
					"SELECT holder, amount FROM sink_fold_balances",
				)
				.all(),
		).toEqual([{ holder: "ALICE", amount: 5 }]);
		expect(
			db
				.query<{ cursor: string }, []>("SELECT cursor FROM sink_fold_transfers")
				.all(),
		).toEqual([{ cursor: "10:0" }]);

		await sink.rollback(12, "11:2147483647");
		expect(
			db
				.query<{ holder: string; amount: number }, []>(
					"SELECT holder, amount FROM sink_fold_balances",
				)
				.all(),
		).toEqual([{ holder: "ALICE", amount: 5 }]);
	});
});
