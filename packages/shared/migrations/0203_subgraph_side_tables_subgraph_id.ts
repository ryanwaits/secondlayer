import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Print-validate violations, handler error groups and processing stats were
 * keyed by subgraph name alone. A subgraph deleted and registered again under
 * the same name got a new id but inherited every row of the old one. Each row
 * now belongs to a `subgraphs.id` and goes with it on delete; `subgraph_name`
 * stays for display.
 *
 * Existing rows take the id of the one subgraph carrying their name. A name no
 * subgraph carries (a deleted one) or more than one does (several accounts on
 * one database) cannot be attributed, so those rows are deleted: they are
 * bounded diagnostics, not records. Safe on empty tables and to run again.
 * Skipped where the tables are absent (not every database carries them).
 *
 * The backfill is one statement per table: fine for the bounded tables these
 * are, to be batched if one ever holds millions of rows.
 */
const TABLES = [
	"subgraph_violations",
	"subgraph_error_groups",
	"subgraph_processing_stats",
] as const;

async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${table}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (!(await tableExists(db, "subgraphs"))) return;
		for (const table of TABLES) {
			if (!(await tableExists(db, table))) continue;
			const t = sql.table(table);
			await sql`
				ALTER TABLE ${t}
					ADD COLUMN IF NOT EXISTS subgraph_id uuid
						REFERENCES subgraphs (id) ON DELETE CASCADE
			`.execute(db);
			await sql`
				UPDATE ${t} AS r
				SET subgraph_id = s.id
				FROM (
					SELECT name, (array_agg(id))[1] AS id
					FROM subgraphs
					GROUP BY name
					HAVING count(*) = 1
				) AS s
				WHERE r.subgraph_id IS NULL AND s.name = r.subgraph_name
			`.execute(db);
			await sql`DELETE FROM ${t} WHERE subgraph_id IS NULL`.execute(db);
			await sql`ALTER TABLE ${t} ALTER COLUMN subgraph_id SET NOT NULL`.execute(
				db,
			);
			// The error groups' unique key below leads with the id already.
			if (table !== "subgraph_error_groups") {
				await sql`
					CREATE INDEX IF NOT EXISTS ${sql.id(`${table}_subgraph_id_idx`)}
						ON ${t} (subgraph_id)
				`.execute(db);
			}
		}
		if (await tableExists(db, "subgraph_error_groups")) {
			await sql`
				ALTER TABLE subgraph_error_groups
					DROP CONSTRAINT IF EXISTS subgraph_error_groups_subgraph_name_fingerprint_key
			`.execute(db);
			await sql`
				CREATE UNIQUE INDEX IF NOT EXISTS subgraph_error_groups_subgraph_id_fingerprint_key
					ON subgraph_error_groups (subgraph_id, fingerprint)
			`.execute(db);
		}
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		if (await tableExists(db, "subgraph_error_groups")) {
			await sql`DROP INDEX IF EXISTS subgraph_error_groups_subgraph_id_fingerprint_key`.execute(
				db,
			);
			await sql`
				DO $$ BEGIN
					IF NOT EXISTS (
						SELECT 1 FROM pg_constraint
						WHERE conrelid = to_regclass('subgraph_error_groups')
							AND conname = 'subgraph_error_groups_subgraph_name_fingerprint_key'
					) THEN
						ALTER TABLE subgraph_error_groups
							ADD CONSTRAINT subgraph_error_groups_subgraph_name_fingerprint_key
							UNIQUE (subgraph_name, fingerprint);
					END IF;
				END $$
			`.execute(db);
		}
		for (const table of TABLES) {
			if (!(await tableExists(db, table))) continue;
			await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS subgraph_id`.execute(
				db,
			);
		}
	});
}
