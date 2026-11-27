import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up as up0131 } from "../migrations/0131_vm_events.ts";
import { up as up0132 } from "../migrations/0132_vm_events_type_ordinal_idx.ts";
import { up as up0133 } from "../migrations/0133_vm_events_fk_cascade.ts";
import { up as up0153 } from "../migrations/0153_vm_events_height_ordinal_pk.ts";
import { up as up0225 } from "../migrations/0225_vm_events_tx_index.ts";

const HAS_DB = !!process.env.DATABASE_URL;

async function withSchema(
	fn: (db: Kysely<unknown>, inTx: Transactional) => Promise<void>,
): Promise<void> {
	if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
	const schema = `migration_0225_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
	const client = postgres(process.env.DATABASE_URL, {
		max: 1,
		onnotice: () => {},
	});
	const db = new Kysely<unknown>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
	const inTx: Transactional = (run) => db.transaction().execute(run);
	try {
		await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
		await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
		await sql`CREATE TABLE blocks (height BIGINT PRIMARY KEY)`.execute(db);
		await sql`
			CREATE TABLE transactions (
				tx_id TEXT PRIMARY KEY,
				block_height BIGINT NOT NULL,
				tx_index INTEGER NOT NULL
			)
		`.execute(db);
		await inTx(up0131);
		await inTx(up0132);
		await inTx(up0133);
		await inTx(up0153);
		await fn(db, inTx);
	} finally {
		await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
		await db.destroy();
	}
}

type Transactional = (
	run: (tx: Kysely<unknown>) => Promise<void>,
) => Promise<void>;

async function columns(db: Kysely<unknown>): Promise<string[]> {
	const { rows } = await sql<{ column_name: string }>`
		SELECT column_name FROM information_schema.columns
		 WHERE table_schema = current_schema() AND table_name = 'vm_events'
		 ORDER BY column_name
	`.execute(db);
	return rows.map((r) => r.column_name);
}

describe.skipIf(!HAS_DB)("0225_vm_events_tx_index migration", () => {
	test("rewrites a small table in place keyed by (block_height, tx_index)", async () => {
		await withSchema(async (db, inTx) => {
			await sql`INSERT INTO blocks VALUES (10), (11)`.execute(db);
			await sql`
				INSERT INTO transactions VALUES ('0xa', 10, 0), ('0xb', 10, 1), ('0xc', 11, 0)
			`.execute(db);
			await sql`
				INSERT INTO vm_events (tx_id, block_height, ordinal, type, data)
				VALUES ('0xa', 10, 0, 'var_set', '{"n":1}'),
				       ('0xb', 10, 1, 'map_set', '{"n":2}'),
				       ('0xc', 11, 0, 'map_delete', '{"n":3}')
			`.execute(db);

			await inTx(up0225);

			expect(await columns(db)).toEqual([
				"block_height",
				"data",
				"ordinal",
				"tx_index",
				"type",
			]);
			const rows = await sql<{
				block_height: string;
				ordinal: number;
				tx_index: number;
			}>`
				SELECT block_height::text, ordinal, tx_index FROM vm_events
				 ORDER BY block_height, ordinal
			`.execute(db);
			expect(rows.rows).toEqual([
				{ block_height: "10", ordinal: 0, tx_index: 0 },
				{ block_height: "10", ordinal: 1, tx_index: 1 },
				{ block_height: "11", ordinal: 0, tx_index: 0 },
			]);
			const constraints = await sql<{ conname: string }>`
				SELECT conname FROM pg_constraint
				 WHERE conrelid = 'vm_events'::regclass ORDER BY conname
			`.execute(db);
			expect(constraints.rows.map((c) => c.conname)).toEqual([
				"vm_events_block_height_fkey",
				"vm_events_pkey",
				"vm_events_type_check",
			]);
			const indexes = await sql<{ indexname: string }>`
				SELECT indexname FROM pg_indexes
				 WHERE schemaname = current_schema() AND tablename = 'vm_events'
				 ORDER BY indexname
			`.execute(db);
			expect(indexes.rows.map((i) => i.indexname)).toEqual([
				"vm_events_pkey",
				"vm_events_type_height_ordinal_idx",
			]);
		});
	});

	test("a re-mined transaction no longer cascades its vm rows away", async () => {
		await withSchema(async (db, inTx) => {
			await sql`INSERT INTO blocks VALUES (10), (11)`.execute(db);
			await sql`INSERT INTO transactions VALUES ('0xa', 10, 0)`.execute(db);
			await sql`
				INSERT INTO vm_events (tx_id, block_height, ordinal, type, data)
				VALUES ('0xa', 10, 0, 'var_set', '{}')
			`.execute(db);
			await inTx(up0225);

			await sql`
				UPDATE transactions SET block_height = 11, tx_index = 3 WHERE tx_id = '0xa'
			`.execute(db);
			await sql`DELETE FROM transactions WHERE tx_id = '0xa'`.execute(db);

			const left = await sql<{ n: number }>`
				SELECT count(*)::int AS n FROM vm_events
			`.execute(db);
			expect(left.rows[0]?.n).toBe(1);
		});
	});

	test("refuses to drop tx_id when a vm row's transaction is not at its height", async () => {
		await withSchema(async (db, inTx) => {
			await sql`INSERT INTO blocks VALUES (10), (11)`.execute(db);
			await sql`INSERT INTO transactions VALUES ('0xa', 11, 0)`.execute(db);
			await sql`
				INSERT INTO vm_events (tx_id, block_height, ordinal, type, data)
				VALUES ('0xa', 10, 0, 'var_set', '{}')
			`.execute(db);

			await expect(inTx(up0225)).rejects.toThrow(
				/1 rows have no transaction at their height/,
			);

			expect(await columns(db)).toContain("tx_id");
			const rows = await sql<{ n: number }>`
				SELECT count(*)::int AS n FROM vm_events
			`.execute(db);
			expect(rows.rows[0]?.n).toBe(1);
		});
	});

	test("is a no-op on a table already in the new shape", async () => {
		await withSchema(async (db, inTx) => {
			await inTx(up0225);
			await inTx(up0225);

			expect(await columns(db)).toEqual([
				"block_height",
				"data",
				"ordinal",
				"tx_index",
				"type",
			]);
		});
	});

	test("an empty table migrates and keeps accepting inserts", async () => {
		await withSchema(async (db, inTx) => {
			await sql`INSERT INTO blocks VALUES (10)`.execute(db);
			await inTx(up0225);

			await sql`
				INSERT INTO vm_events (block_height, ordinal, tx_index, type, data)
				VALUES (10, 0, 0, 'var_set', '{}')
			`.execute(db);
			const rows = await sql<{ n: number }>`
				SELECT count(*)::int AS n FROM vm_events
			`.execute(db);
			expect(rows.rows[0]?.n).toBe(1);
		});
	});
});
