import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up as up0083 } from "../migrations/0083_burnchain_rewards.ts";
import {
	down as down0107,
	up as up0107,
} from "../migrations/0107_burnchain_drop_canonical.ts";
import type { Database } from "../src/db/types.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const TABLES = ["burn_block_rewards", "burn_block_reward_slots"] as const;

async function columnNames(
	db: Kysely<Database>,
	schema: string,
	table: string,
): Promise<string[]> {
	const rows = await sql<{ column_name: string }>`
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = ${schema} AND table_name = ${table}
	`.execute(db);
	return rows.rows.map((r) => r.column_name);
}

async function indexNames(
	db: Kysely<Database>,
	schema: string,
	table: string,
): Promise<string[]> {
	const rows = await sql<{ indexname: string }>`
		SELECT indexname FROM pg_indexes
		WHERE schemaname = ${schema} AND tablename = ${table}
	`.execute(db);
	return rows.rows.map((r) => r.indexname);
}

describe.skipIf(!HAS_DB)("0107_burnchain_drop_canonical migration", () => {
	test("drops canonical + swaps to plain height indexes, and round-trips", async () => {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");

		const schema = `migration_0107_${Date.now().toString(36)}`;
		const client = postgres(process.env.DATABASE_URL, { max: 1 });
		const db = new Kysely<Database>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});

		try {
			await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
			await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);

			await up0083(db);

			// Pre-0107 rows (canonical present via DEFAULT) must survive the drop.
			await sql`
				INSERT INTO burn_block_rewards
					(cursor, burn_block_height, burn_block_hash, reward_index, recipient_btc, amount_sats)
				VALUES ('900000:0', 900000, '0xburn', 0, 'bc1qexample', '625000000')
			`.execute(db);

			await up0107(db);

			for (const table of TABLES) {
				expect(await columnNames(db, schema, table)).not.toContain("canonical");
				const idx = await indexNames(db, schema, table);
				expect(idx).toContain(`${table}_height_idx`);
				expect(idx).not.toContain(`${table}_canonical_height_idx`);
			}
			const kept = await sql<{ cursor: string }>`
				SELECT cursor FROM burn_block_rewards WHERE burn_block_height = 900000
			`.execute(db);
			expect(kept.rows.map((r) => r.cursor)).toEqual(["900000:0"]);

			await down0107(db);

			for (const table of TABLES) {
				expect(await columnNames(db, schema, table)).toContain("canonical");
				const idx = await indexNames(db, schema, table);
				expect(idx).toContain(`${table}_canonical_height_idx`);
				expect(idx).not.toContain(`${table}_height_idx`);
			}
			// down re-adds canonical NOT NULL DEFAULT true — existing rows backfill true.
			const backfilled = await sql<{ canonical: boolean }>`
				SELECT canonical FROM burn_block_rewards WHERE cursor = '900000:0'
			`.execute(db);
			expect(backfilled.rows).toEqual([{ canonical: true }]);
		} finally {
			await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
			await db.destroy();
		}
	});
});
