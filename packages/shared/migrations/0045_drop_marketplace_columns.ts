import { type Kysely, sql } from "kysely";

/**
 * Drop the marketplace-era columns from `subgraphs`. The marketplace
 * feature is gone (see `0022_marketplace`); these columns were only
 * written by the deleted publish/unpublish endpoints and read by the
 * deleted marketplace browse routes.
 *
 * Production note: the platform DB's `subgraphs` table was manually dropped
 * after migration `0041` as part of the shared→dedicated cutover (see the
 * note there). This migration must tolerate that — it runs fine on OSS
 * deployments and fresh dev DBs where the table still exists, and no-ops
 * on production where the table is already gone.
 *
 * Indexes `subgraphs_is_public_idx` and `subgraphs_tags_idx` from 0022
 * drop automatically with the columns.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`
		DO $$
		BEGIN
			IF to_regclass('public.subgraphs') IS NOT NULL THEN
				ALTER TABLE subgraphs DROP COLUMN IF EXISTS forked_from_id;
				ALTER TABLE subgraphs DROP COLUMN IF EXISTS description;
				ALTER TABLE subgraphs DROP COLUMN IF EXISTS tags;
				ALTER TABLE subgraphs DROP COLUMN IF EXISTS is_public;
			END IF;
		END$$
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	// Re-adding these columns would resurrect dead feature state; only
	// restore them where the table exists, to match the up() guard.
	await sql`
		DO $$
		BEGIN
			IF to_regclass('public.subgraphs') IS NOT NULL THEN
				ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
				ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
				ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS description text;
				ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS forked_from_id uuid REFERENCES subgraphs(id) ON DELETE SET NULL;
			END IF;
		END$$
	`.execute(db);
}
