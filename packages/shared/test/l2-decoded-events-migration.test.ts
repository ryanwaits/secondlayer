import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { down, up } from "../migrations/0065_l2_decoded_events.ts";
import type { Database } from "../src/db/types.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("0065_l2_decoded_events migration", () => {
	test("up and down run cleanly against a fresh schema", async () => {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");

		const schema = `migration_0065_${Date.now().toString(36)}`;
		const client = postgres(process.env.DATABASE_URL, { max: 1 });
		const db = new Kysely<Database>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});

		try {
			await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
			await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);

			await up(db);

			const tables = await sql<{ table_name: string }>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${schema}
        ORDER BY table_name
      `.execute(db);
			const indexes = await sql<{ indexname: string }>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = ${schema}
        ORDER BY indexname
      `.execute(db);

			expect(tables.rows.map((row) => row.table_name)).toEqual([
				"decoded_events",
				"l2_decoder_checkpoints",
			]);
			expect(indexes.rows.map((row) => row.indexname)).toContain(
				"decoded_events_block_height_idx",
			);
			expect(indexes.rows.map((row) => row.indexname)).toContain(
				"decoded_events_event_type_idx",
			);
			expect(indexes.rows.map((row) => row.indexname)).toContain(
				"decoded_events_tx_id_event_index_idx",
			);

			await down(db);

			const afterDown = await sql<{ table_name: string }>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${schema}
      `.execute(db);
			expect(afterDown.rows).toEqual([]);
		} finally {
			await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
			await db.destroy();
			await client.end();
		}
	});
});
