import { type Kysely, sql } from "kysely";

/**
 * Make `subgraphs.api_key_id` nullable to support oss/dedicated modes where
 * there's no per-tenant API key concept. In platform mode the column stays
 * populated on every insert; in oss/dedicated it's NULL.
 *
 * A partial unique index on `(name) WHERE api_key_id IS NULL` enforces the
 * single-tenant constraint: within a non-platform instance, subgraph names
 * are globally unique (there's only one "tenant"). Platform mode's existing
 * uniqueness constraint on `(api_key_id, name)` stays in place for the
 * multi-tenant case.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE subgraphs ALTER COLUMN api_key_id DROP NOT NULL`.execute(
		db,
	);
	await sql`
		CREATE UNIQUE INDEX IF NOT EXISTS subgraphs_name_unique_no_key
		ON subgraphs (name)
		WHERE api_key_id IS NULL
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS subgraphs_name_unique_no_key`.execute(db);
	// Intentionally does NOT re-add NOT NULL — any rows inserted while the
	// constraint was relaxed would break the migration. Operators should
	// backfill api_key_id before re-applying NOT NULL manually if desired.
}
