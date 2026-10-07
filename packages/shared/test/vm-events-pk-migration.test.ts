import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up as up0131 } from "../migrations/0131_vm_events.ts";
import { up as up0132 } from "../migrations/0132_vm_events_type_ordinal_idx.ts";
import { up as up0133 } from "../migrations/0133_vm_events_fk_cascade.ts";
import {
	down as down0153,
	up as up0153,
} from "../migrations/0153_vm_events_height_ordinal_pk.ts";

const HAS_DB = !!process.env.DATABASE_URL;

async function primaryKeyColumns(
	db: Kysely<unknown>,
	schema: string,
): Promise<string[]> {
	const { rows } = await sql<{ attname: string }>`
		SELECT a.attname
		  FROM pg_index i
		  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
		 WHERE i.indrelid = ${`${schema}.vm_events`}::regclass AND i.indisprimary
		 ORDER BY array_position(i.indkey, a.attnum)
	`.execute(db);
	return rows.map((r) => r.attname);
}

async function indexNames(db: Kysely<unknown>, schema: string) {
	const { rows } = await sql<{ indexname: string }>`
		SELECT indexname FROM pg_indexes
		 WHERE schemaname = ${schema} AND tablename = 'vm_events'
		 ORDER BY indexname
	`.execute(db);
	return rows.map((r) => r.indexname);
}

async function columnNames(db: Kysely<unknown>, schema: string) {
	const { rows } = await sql<{ column_name: string }>`
		SELECT column_name FROM information_schema.columns
		 WHERE table_schema = ${schema} AND table_name = 'vm_events'
	`.execute(db);
	return rows.map((r) => r.column_name);
}

describe.skipIf(!HAS_DB)("0153_vm_events_height_ordinal_pk migration", () => {
	test("promotes (block_height, ordinal) to the primary key, keeps rows, and round-trips", async () => {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
		const schema = `migration_0153_${Date.now().toString(36)}`;
		const client = postgres(process.env.DATABASE_URL, {
			max: 1,
			onnotice: () => {},
		});
		const db = new Kysely<unknown>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
		// The migrate runner wraps each run in a transaction; SET LOCAL needs one.
		const inTx = (fn: (tx: Kysely<unknown>) => Promise<void>) =>
			db.transaction().execute(fn);

		try {
			await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
			await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
			await sql`CREATE TABLE blocks (height BIGINT PRIMARY KEY)`.execute(db);
			await sql`
				CREATE TABLE transactions (tx_id TEXT PRIMARY KEY, block_height BIGINT NOT NULL)
			`.execute(db);
			await inTx(up0131);
			await inTx(up0132);
			await inTx(up0133);

			await sql`INSERT INTO blocks VALUES (10), (11)`.execute(db);
			await sql`INSERT INTO transactions VALUES ('0xa', 10), ('0xb', 11)`.execute(
				db,
			);
			await sql`
				INSERT INTO vm_events (tx_id, block_height, ordinal, type, data)
				VALUES ('0xa', 10, 0, 'var_set', '{}'), ('0xa', 10, 1, 'map_set', '{}'),
				       ('0xb', 11, 0, 'map_delete', '{}')
			`.execute(db);

			await inTx(up0153);

			expect(await primaryKeyColumns(db, schema)).toEqual([
				"block_height",
				"ordinal",
			]);
			expect(await columnNames(db, schema)).not.toContain("id");
			expect(await indexNames(db, schema)).toEqual([
				"vm_events_pkey",
				"vm_events_tx_id_idx",
				"vm_events_type_height_ordinal_idx",
			]);
			const { rows } = await sql<{ n: number }>`
				SELECT count(*)::int AS n FROM vm_events
			`.execute(db);
			expect(rows[0]?.n).toBe(3);

			// Same-key redelivery stays a no-op under the new key.
			await sql`
				INSERT INTO vm_events (tx_id, block_height, ordinal, type, data)
				VALUES ('0xa', 10, 0, 'var_set', '{"dup":true}')
				ON CONFLICT DO NOTHING
			`.execute(db);
			const { rows: after } = await sql<{ n: number }>`
				SELECT count(*)::int AS n FROM vm_events
			`.execute(db);
			expect(after[0]?.n).toBe(3);

			// The tx_id cascade still removes child rows.
			await sql`DELETE FROM transactions WHERE tx_id = '0xb'`.execute(db);
			const { rows: cascaded } = await sql<{ n: number }>`
				SELECT count(*)::int AS n FROM vm_events WHERE block_height = 11
			`.execute(db);
			expect(cascaded[0]?.n).toBe(0);

			// Re-running is a no-op (already migrated).
			await inTx(up0153);
			expect(await primaryKeyColumns(db, schema)).toEqual([
				"block_height",
				"ordinal",
			]);

			await inTx(down0153);
			expect(await primaryKeyColumns(db, schema)).toEqual(["id"]);
			expect(await indexNames(db, schema)).toEqual([
				"vm_events_block_height_idx",
				"vm_events_logical_id_uniq",
				"vm_events_pkey",
				"vm_events_tx_id_idx",
				"vm_events_type_height_idx",
				"vm_events_type_height_ordinal_idx",
			]);
		} finally {
			await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
			await db.destroy();
		}
	});
});
