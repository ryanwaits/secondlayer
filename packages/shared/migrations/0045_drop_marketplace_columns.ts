import { type Kysely, sql } from "kysely";

/**
 * Drop the marketplace-era columns from `subgraphs`. The marketplace
 * feature is gone (see `0022_marketplace`); these columns were only
 * written by the deleted publish/unpublish endpoints and read by the
 * deleted marketplace browse routes.
 *
 * Indexes `subgraphs_is_public_idx` and `subgraphs_tags_idx` from 0022
 * drop automatically with the columns.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS forked_from_id`.execute(
		db,
	);
	await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS description`.execute(
		db,
	);
	await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS tags`.execute(db);
	await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS is_public`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	// Re-adding these columns would resurrect dead feature state; not supported.
	await sql`ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false`.execute(
		db,
	);
	await sql`ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'`.execute(
		db,
	);
	await sql`ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS description text`.execute(
		db,
	);
	await sql`ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS forked_from_id uuid REFERENCES subgraphs(id) ON DELETE SET NULL`.execute(
		db,
	);
}
