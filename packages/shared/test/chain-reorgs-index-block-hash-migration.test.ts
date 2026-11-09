import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up } from "../migrations/0209_chain_reorgs_index_block_hash.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("0209_chain_reorgs_index_block_hash migration", () => {
	test("rewrites reorg rows from block hashes to index hashes, nulls what it cannot resolve", async () => {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
		const schema = `migration_0209_${Date.now().toString(36)}`;
		const client = postgres(process.env.DATABASE_URL, { max: 1 });
		const db = new Kysely<unknown>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
		try {
			await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
			await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
			await sql`CREATE TABLE blocks (height BIGINT PRIMARY KEY, hash TEXT NOT NULL, index_block_hash TEXT)`.execute(
				db,
			);
			await sql`CREATE TABLE pending_fork_blocks (height BIGINT, block_hash TEXT, payload JSONB)`.execute(
				db,
			);
			await sql`CREATE TABLE chain_reorgs (id INT PRIMARY KEY, fork_point_height BIGINT, old_index_block_hash TEXT, new_index_block_hash TEXT)`.execute(
				db,
			);
			await sql`
				INSERT INTO blocks VALUES
					(100, '0xnew', '0xnew-index'),
					(200, '0xback', '0xback-index'),
					(300, '0xfixed', '0xfixed-index')
			`.execute(db);
			await sql`
				INSERT INTO pending_fork_blocks VALUES
					(100, '0xold', '{"index_block_hash":"0xold-index"}')
			`.execute(db);
			await sql`
				INSERT INTO chain_reorgs VALUES
					(1, 100, '0xold', '0xnew'),
					(2, 200, '0xlost', '0xback'),
					(3, 300, '0xgone-index', '0xfixed-index')
			`.execute(db);

			await up(db);

			const { rows } = await sql<{
				id: number;
				old_index_block_hash: string | null;
				new_index_block_hash: string | null;
			}>`SELECT id, old_index_block_hash, new_index_block_hash FROM chain_reorgs ORDER BY id`.execute(
				db,
			);
			expect(rows).toEqual([
				// Old side from the staged deposed block, new from blocks.
				{
					id: 1,
					old_index_block_hash: "0xold-index",
					new_index_block_hash: "0xnew-index",
				},
				// A block hash no table holds any more becomes unknown.
				{
					id: 2,
					old_index_block_hash: null,
					new_index_block_hash: "0xback-index",
				},
				// A side already naming its height's index hash is kept.
				{
					id: 3,
					old_index_block_hash: null,
					new_index_block_hash: "0xfixed-index",
				},
			]);
		} finally {
			await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
			await db.destroy();
		}
	});
});
