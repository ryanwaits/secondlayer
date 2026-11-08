import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import {
	down,
	up,
} from "../migrations/0203_subgraph_side_tables_subgraph_id.ts";

const HAS_DB = !!process.env.DATABASE_URL;

async function withSchema(
	fn: (db: Kysely<unknown>, schema: string) => Promise<void>,
) {
	if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
	const schema = `migration_0203_${Date.now().toString(36)}`;
	const client = postgres(process.env.DATABASE_URL, {
		max: 1,
		onnotice: () => {},
	});
	const db = new Kysely<unknown>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
	try {
		await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
		await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
		await fn(db, schema);
	} finally {
		await sql`SET search_path TO public`.execute(db).catch(() => {});
		await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`
			.execute(db)
			.catch(() => {});
		await db.destroy();
	}
}

/** The three tables as they were before the migration. */
async function createOldTables(db: Kysely<unknown>) {
	await sql`
		CREATE TABLE subgraphs (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			name text NOT NULL,
			account_id text NOT NULL DEFAULT ''
		)
	`.execute(db);
	await sql`
		CREATE TABLE subgraph_violations (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			subgraph_name text NOT NULL,
			source_name text NOT NULL DEFAULT 's',
			block_height bigint NOT NULL DEFAULT 1,
			tx_id text NOT NULL DEFAULT '0x',
			reason text NOT NULL DEFAULT 'r',
			sample_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
			seen_at timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db);
	await sql`
		CREATE TABLE subgraph_error_groups (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			subgraph_name text NOT NULL,
			fingerprint text NOT NULL,
			source_name text NOT NULL DEFAULT 's',
			message text NOT NULL DEFAULT 'm',
			count bigint NOT NULL DEFAULT 1,
			UNIQUE (subgraph_name, fingerprint)
		)
	`.execute(db);
	await sql`
		CREATE TABLE subgraph_processing_stats (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			subgraph_name text NOT NULL,
			blocks_processed integer
		)
	`.execute(db);
}

async function count(db: Kysely<unknown>, table: string): Promise<number> {
	const { rows } = await sql<{ n: string }>`
		SELECT count(*)::text AS n FROM ${sql.table(table)}
	`.execute(db);
	return Number(rows[0]?.n);
}

describe.skipIf(!HAS_DB)("0203_subgraph_side_tables_subgraph_id", () => {
	test("backfills the id by name, deletes rows of subgraphs that no longer exist, and enforces the key", async () => {
		await withSchema(async (db) => {
			await createOldTables(db);
			await sql`INSERT INTO subgraphs (name) VALUES ('kept')`.execute(db);
			// A name two rows share cannot be attributed to either.
			await sql`
				INSERT INTO subgraphs (name, account_id) VALUES ('shared', 'a'), ('shared', 'b')
			`.execute(db);
			for (const name of ["kept", "gone", "shared"]) {
				await sql`INSERT INTO subgraph_violations (subgraph_name) VALUES (${name})`.execute(
					db,
				);
				await sql`
					INSERT INTO subgraph_error_groups (subgraph_name, fingerprint) VALUES (${name}, 'fp')
				`.execute(db);
				await sql`INSERT INTO subgraph_processing_stats (subgraph_name) VALUES (${name})`.execute(
					db,
				);
			}

			await up(db);

			const kept = (
				await sql<{
					id: string;
				}>`SELECT id FROM subgraphs WHERE name = 'kept'`.execute(db)
			).rows[0]?.id;
			for (const table of [
				"subgraph_violations",
				"subgraph_error_groups",
				"subgraph_processing_stats",
			]) {
				const { rows } = await sql<{
					subgraph_name: string;
					subgraph_id: string;
				}>`
					SELECT subgraph_name, subgraph_id FROM ${sql.table(table)}
				`.execute(db);
				expect(rows).toEqual([{ subgraph_name: "kept", subgraph_id: kept }]);
			}

			// NOT NULL: a write that names no subgraph is refused.
			await expect(
				sql`INSERT INTO subgraph_violations (subgraph_name) VALUES ('kept')`.execute(
					db,
				),
			).rejects.toThrow(/subgraph_id/);

			// One error group per (subgraph id, fingerprint).
			await expect(
				sql`
					INSERT INTO subgraph_error_groups (subgraph_name, subgraph_id, fingerprint)
					VALUES ('kept', ${kept}, 'fp')
				`.execute(db),
			).rejects.toThrow(/duplicate key/);
			// ...and the old per-name key is gone: a recreated name's id is a new key.
			await sql`
				INSERT INTO subgraph_error_groups (subgraph_name, subgraph_id, fingerprint)
				SELECT 'kept', id, 'fp' FROM subgraphs WHERE name = 'shared' LIMIT 1
			`.execute(db);

			// Deleting the subgraph takes its rows with it.
			await sql`DELETE FROM subgraphs WHERE name = 'kept'`.execute(db);
			expect(await count(db, "subgraph_violations")).toBe(0);
			expect(await count(db, "subgraph_processing_stats")).toBe(0);
			expect(await count(db, "subgraph_error_groups")).toBe(1);
		});
	});

	test("runs on empty tables, runs again without change, and rolls back", async () => {
		await withSchema(async (db, schema) => {
			await createOldTables(db);

			await up(db);
			await up(db);

			const columns = async () =>
				(
					await sql<{ table_name: string }>`
						SELECT table_name FROM information_schema.columns
						WHERE table_schema = ${schema} AND column_name = 'subgraph_id'
						ORDER BY table_name
					`.execute(db)
				).rows.map((r) => r.table_name);
			expect(await columns()).toEqual([
				"subgraph_error_groups",
				"subgraph_processing_stats",
				"subgraph_violations",
			]);

			await down(db);
			expect(await columns()).toEqual([]);
			// The per-name key is back.
			await sql`INSERT INTO subgraph_error_groups (subgraph_name, fingerprint) VALUES ('x', 'fp')`.execute(
				db,
			);
			await expect(
				sql`INSERT INTO subgraph_error_groups (subgraph_name, fingerprint) VALUES ('x', 'fp')`.execute(
					db,
				),
			).rejects.toThrow(/duplicate key/);
		});
	});

	test("does nothing in a database without the subgraph tables", async () => {
		await withSchema(async (db) => {
			await up(db);
			await down(db);
		});
	});
});
