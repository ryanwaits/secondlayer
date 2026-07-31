import { afterAll, describe, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { kyselySink } from "../sinks/kysely.ts";
import { attachSinkConformance } from "../sinks/testing.ts";

/**
 * kyselySink run through the sink conformance kit — the reference
 * implementation proving its own contract with the same probes any
 * third-party sink is asked to pass. Requires the dev Postgres (`bun run
 * db`, binds 127.0.0.1:5440); skips locally when absent, FAILS in CI (a
 * green check for probes that never ran is worse than a red one).
 */

const DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

interface Database {
	sink_conformance_rows: { key: string; height: number };
	sl_consumer_checkpoints: { id: string; cursor: string };
}

const db = new Kysely<Database>({
	dialect: new PostgresDialect({
		pool: new pg.Pool({ connectionString: DATABASE_URL, max: 4 }),
	}),
});

const dbUp = await sql`SELECT 1`
	.execute(db)
	.then(() => true)
	.catch((err) => {
		if (process.env.CI) {
			throw new Error(
				`kysely sink conformance suite cannot reach Postgres at ${DATABASE_URL}: ${
					err instanceof Error ? err.message : String(err)
				}. In CI this is a failure — skipping would report success for contract probes that never ran.`,
			);
		}
		return false;
	});

const SINK_ID = "sink-conformance";

afterAll(async () => {
	if (dbUp) {
		await sql`DROP TABLE IF EXISTS sink_conformance_rows`.execute(db);
	}
	await db.destroy();
});

describe.skipIf(!dbUp)("kyselySink conformance", () => {
	attachSinkConformance(test, {
		makeSink: () =>
			kyselySink(db, {
				id: SINK_ID,
				tables: ["sink_conformance_rows"],
				height: "height",
			}),

		async reset() {
			await sql`
				DROP TABLE IF EXISTS sink_conformance_rows;
				CREATE TABLE sink_conformance_rows (key text PRIMARY KEY, height integer NOT NULL);
				CREATE TABLE IF NOT EXISTS sl_consumer_checkpoints (id text PRIMARY KEY, cursor text NOT NULL);
			`.execute(db);
			await sql`DELETE FROM sl_consumer_checkpoints WHERE id = ${SINK_ID}`.execute(
				db,
			);
		},

		async insertRow(tx, height, key) {
			// Replay-safe, as the contract requires of real handlers.
			await tx
				.insertInto("sink_conformance_rows")
				.values({ key, height })
				.onConflict((oc) => oc.column("key").doNothing())
				.execute();
		},

		async readRows() {
			return db
				.selectFrom("sink_conformance_rows")
				.select(["height", "key"])
				.execute();
		},

		async readCursor() {
			const row = await db
				.selectFrom("sl_consumer_checkpoints")
				.select("cursor")
				.where("id", "=", SINK_ID)
				.executeTakeFirst();
			return row?.cursor ?? null;
		},

		async withLockHeld(during) {
			// Hold the advisory lock in an open transaction on another
			// connection, as a second live replica would.
			let release: (() => void) | undefined;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			let acquired: (() => void) | undefined;
			const ready = new Promise<void>((resolve) => {
				acquired = resolve;
			});
			const holder = db.transaction().execute(async (tx) => {
				await sql`SELECT pg_advisory_xact_lock(hashtextextended(${SINK_ID}, 0))`.execute(
					tx,
				);
				acquired?.();
				await held;
			});
			await ready;
			try {
				await during();
			} finally {
				release?.();
				await holder;
			}
		},
	});
});
