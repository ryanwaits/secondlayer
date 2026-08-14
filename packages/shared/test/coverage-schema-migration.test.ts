import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { down, up } from "../migrations/0116_coverage_schema.ts";
import { setMigrationRole } from "../src/db/migration-role.ts";
import type { Database } from "../src/db/types.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("0116_coverage_schema", () => {
	async function withSchema(
		fn: (db: Kysely<Database>) => Promise<void>,
	): Promise<void> {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
		const schema = `migration_0116_${Date.now().toString(36)}`;
		const client = postgres(process.env.DATABASE_URL, { max: 1 });
		const db = new Kysely<Database>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
		setMigrationRole("both");
		try {
			await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
			await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
			await up(db as Kysely<unknown>);
			await fn(db);
			await down(db as Kysely<unknown>);
			const after = await sql<{ table_name: string }>`
				SELECT table_name
				FROM information_schema.tables
				WHERE table_schema = ${schema}
			`.execute(db);
			expect(after.rows).toEqual([]);
		} finally {
			await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
			await db.destroy();
			await client.end();
		}
	}

	test("creates the five coverage tables and rolls them back", async () => {
		await withSchema(async (db) => {
			const tables = await sql<{ table_name: string }>`
				SELECT table_name
				FROM information_schema.tables
				WHERE table_schema = current_schema()
				ORDER BY table_name
			`.execute(db);
			expect(tables.rows.map((r) => r.table_name)).toEqual([
				"coverage_segments",
				"stage_block_receipts",
				"stage_failures",
				"stage_registry",
				"stage_runs",
			]);
		});
	});

	test("rejects invalid enum, inverted range, and unfinalized compact", async () => {
		await withSchema(async (db) => {
			await sql`
				INSERT INTO stage_registry
					(id, kind, native_clock, producer_version, repair_mode)
				VALUES ('raw', 'raw', 'block', 'test', 'archive_replay')
			`.execute(db);

			await expect(
				sql`
					INSERT INTO stage_registry
						(id, kind, native_clock, producer_version, repair_mode)
					VALUES ('bad', 'layer', 'block', 'test', 'none')
				`.execute(db),
			).rejects.toThrow();

			await expect(
				sql`
					INSERT INTO coverage_segments
						(stage_id, from_height, to_height, chain_digest, input_digest, output_digest)
					VALUES ('raw', 10, 5, 'c', 'i', 'o')
				`.execute(db),
			).rejects.toThrow();

			await expect(
				sql`
					INSERT INTO stage_block_receipts
						(stage_id, block_height, block_hash, input_count,
						 input_digest, effect_digest, finalized, compacted_at)
					VALUES ('raw', 1, '0xab', 0, 'i', 'e', false, now())
				`.execute(db),
			).rejects.toThrow();

			await expect(
				sql`
					INSERT INTO stage_failures
						(stage_id, unit_kind, class, retry_state, retain_until, created_at)
					VALUES (
						'raw', 'block', 'crash', 'open',
						'2020-01-01', '2026-01-01'
					)
				`.execute(db),
			).rejects.toThrow();

			await expect(
				sql`
					INSERT INTO stage_failures
						(stage_id, unit_kind, class, retry_state)
					VALUES ('raw', 'block', 'crash', 'resolved')
				`.execute(db),
			).rejects.toThrow();

			await sql`
				INSERT INTO stage_block_receipts
					(stage_id, block_height, block_hash, input_count,
					 input_digest, effect_digest, finalized)
				VALUES ('raw', 1, '0xab', 0, 'i', 'e', true)
			`.execute(db);

			await sql`
				INSERT INTO coverage_segments
					(stage_id, from_height, to_height, chain_digest, input_digest, output_digest)
				VALUES ('raw', 1, 1, 'c', 'i', 'o')
			`.execute(db);

			await sql`
				INSERT INTO stage_failures
					(stage_id, unit_kind, class, retry_state, resolved_at)
				VALUES ('raw', 'block', 'crash', 'resolved', now())
			`.execute(db);
		});
	});
});
