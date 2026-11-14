import { afterEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { down } from "../migrations/0212_events_transactions_redundant_indexes.ts";
import { runFileMigrations } from "../src/db/migrate.ts";
import { setMigrationRole } from "../src/db/migration-role.ts";
import {
	createTestDatabase,
	createTestDb,
	dropTestDatabase,
	hasTestDb,
} from "../src/db/test-helpers.ts";

const HAS_DB = hasTestDb("events/transactions redundant indexes migration");
const BUILD_TIMEOUT_MS = 300_000;
const PREVIOUS_MIGRATION = "0211_decoded_events_slim";
const DROPPED = [
	"events_type_idx",
	"events_block_height_idx",
	"transactions_block_height_idx",
];
const COVERING = [
	"events_height_type_idx",
	"events_logical_id_uniq",
	"transactions_height_tx_index_uniq",
];

async function withDatabase(
	fn: (db: Kysely<unknown>) => Promise<void>,
): Promise<void> {
	const url = await createTestDatabase();
	const db = createTestDb(url) as Kysely<unknown>;
	try {
		await fn(db);
	} finally {
		await db.destroy();
		await dropTestDatabase(url);
	}
}

async function existing(
	db: Kysely<unknown>,
	names: string[],
): Promise<string[]> {
	const { rows } = await sql<{ indexname: string }>`
		SELECT indexname FROM pg_indexes
		WHERE schemaname = current_schema() AND indexname IN (${sql.join(names)})
		ORDER BY indexname
	`.execute(db);
	return rows.map((r) => r.indexname);
}

async function migrateAll(db: Kysely<unknown>): Promise<void> {
	const { error } = await runFileMigrations(db);
	if (error) throw error;
}

async function explain(db: Kysely<unknown>, query: string): Promise<string> {
	return await db.transaction().execute(async (trx) => {
		await sql`SET LOCAL enable_seqscan = off`.execute(trx);
		const { rows } = await sql<{ "QUERY PLAN": string }>`
			EXPLAIN ${sql.raw(query)}
		`.execute(trx);
		return rows.map((r) => r["QUERY PLAN"]).join("\n");
	});
}

describe.skipIf(!HAS_DB)(
	"events_transactions_redundant_indexes migration",
	() => {
		afterEach(() => setMigrationRole("both"));

		test(
			"a full migrate drops the redundant indexes and keeps the covering ones",
			async () => {
				await withDatabase(async (db) => {
					await migrateAll(db);
					expect(await existing(db, DROPPED)).toEqual([]);
					expect(await existing(db, COVERING)).toEqual([...COVERING].sort());
				});
			},
			BUILD_TIMEOUT_MS,
		);

		test(
			"transactions keeps its plain height index when the unique index is missing",
			async () => {
				await withDatabase(async (db) => {
					const partial = await runFileMigrations(db, {
						through: PREVIOUS_MIGRATION,
					});
					if (partial.error) throw partial.error;
					expect(partial.results?.at(-1)?.migrationName).toBe(
						PREVIOUS_MIGRATION,
					);
					await sql`DROP INDEX transactions_height_tx_index_uniq`.execute(db);
					await migrateAll(db);
					expect(await existing(db, DROPPED)).toEqual([
						"transactions_block_height_idx",
					]);
				});
			},
			BUILD_TIMEOUT_MS,
		);

		test(
			"height reads still use a covering index",
			async () => {
				await withDatabase(async (db) => {
					await migrateAll(db);
					expect(
						await explain(db, "SELECT * FROM events WHERE block_height = 5"),
					).toMatch(/events_(height_type_idx|logical_id_uniq)/);
					expect(
						await explain(
							db,
							"SELECT * FROM transactions WHERE block_height = 5",
						),
					).toContain("transactions_height_tx_index_uniq");
				});
			},
			BUILD_TIMEOUT_MS,
		);

		test(
			"down recreates all three indexes",
			async () => {
				await withDatabase(async (db) => {
					await migrateAll(db);
					await down(db);
					expect(await existing(db, DROPPED)).toEqual([...DROPPED].sort());
				});
			},
			BUILD_TIMEOUT_MS,
		);
	},
);
