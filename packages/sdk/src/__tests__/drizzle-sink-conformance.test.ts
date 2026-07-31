import { afterAll, describe, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import pg from "pg";
import { drizzleSink } from "../sinks/drizzle.ts";
import { attachSinkConformance } from "../sinks/testing.ts";

/**
 * drizzleSink (Postgres dialect) through the sink conformance kit. The
 * schema deliberately uses a camelCase column KEY over a snake_case SQL
 * name (`blockHeight` → `block_height`) to prove key→name resolution.
 * Requires the dev Postgres (`bun run db`, binds 127.0.0.1:5440); skips
 * locally when absent, FAILS in CI.
 */

const DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const rows = pgTable("drizzle_conformance_rows", {
	key: text("key").primaryKey(),
	blockHeight: integer("block_height").notNull(),
});

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const db = drizzle(pool);
const SINK_ID = "sink-conformance-drizzle";

const dbUp = await db
	.execute(sql`SELECT 1`)
	.then(() => true)
	.catch((err) => {
		if (process.env.CI) {
			throw new Error(
				`drizzle sink conformance suite cannot reach Postgres at ${DATABASE_URL}: ${
					err instanceof Error ? err.message : String(err)
				}. In CI this is a failure — skipping would report success for contract probes that never ran.`,
			);
		}
		return false;
	});

afterAll(async () => {
	if (dbUp) {
		await db.execute(sql`DROP TABLE IF EXISTS drizzle_conformance_rows`);
	}
	await pool.end();
});

describe.skipIf(!dbUp)("drizzleSink conformance (Postgres)", () => {
	attachSinkConformance(test, {
		makeSink: () =>
			drizzleSink(db, {
				id: SINK_ID,
				tables: [rows],
				height: "blockHeight",
			}),

		async reset() {
			await db.execute(sql`DROP TABLE IF EXISTS drizzle_conformance_rows`);
			await db.execute(
				sql`CREATE TABLE drizzle_conformance_rows (key text PRIMARY KEY, block_height integer NOT NULL)`,
			);
			await db.execute(
				sql`CREATE TABLE IF NOT EXISTS sl_consumer_checkpoints (id text PRIMARY KEY, cursor text NOT NULL)`,
			);
			await db.execute(
				sql`DELETE FROM sl_consumer_checkpoints WHERE id = ${SINK_ID}`,
			);
		},

		async insertRow(tx, height, key) {
			// Replay-safe, as the contract requires of real handlers.
			await tx
				.insert(rows)
				.values({ key, blockHeight: height })
				.onConflictDoNothing();
		},

		async readRows() {
			const found = await db
				.select({ height: rows.blockHeight, key: rows.key })
				.from(rows);
			return found;
		},

		async readCursor() {
			const found = await db.execute(
				sql`SELECT cursor FROM sl_consumer_checkpoints WHERE id = ${SINK_ID}`,
			);
			return (found.rows[0] as { cursor: string } | undefined)?.cursor ?? null;
		},

		async withLockHeld(during) {
			// Hold the advisory lock on another connection, as a second live
			// replica would. drizzleSink locks on hashtextextended(id, 0).
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				await client.query(
					"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
					[SINK_ID],
				);
				await during();
			} finally {
				await client.query("ROLLBACK").catch(() => {});
				client.release();
			}
		},
	});
});
