import { type Kysely, sql } from "kysely";

/**
 * Post-cutover cleanup: drop `subgraphs.api_key_id` and the partial unique
 * index that went with nullable-api-key-id handling. Every subgraph lives in
 * a tenant DB now; tenants authenticate via JWT (TENANT_JWT_SECRET), not
 * per-account API keys — so this column has been dead weight since migration
 * 0037 made it nullable.
 *
 * Runs against BOTH the platform DB and every tenant DB (migrations share
 * the same list). The platform DB's `subgraphs` table is manually dropped
 * as a one-off operation AFTER this migration (see Phase 2 cutover notes).
 *
 * Restores the simple `UNIQUE (name)` constraint the table started with —
 * tenant subgraphs were always name-unique within a tenant.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`DROP INDEX IF EXISTS subgraphs_name_unique_no_key`.execute(db);
	await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS api_key_id`.execute(db);
	// Re-add the simple name-unique constraint if it's not already there
	// (noop if it was never dropped in a prior migration).
	await sql`
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'subgraphs_name_unique'
			) THEN
				ALTER TABLE subgraphs ADD CONSTRAINT subgraphs_name_unique UNIQUE (name);
			END IF;
		END$$
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE subgraphs DROP CONSTRAINT IF EXISTS subgraphs_name_unique`.execute(
		db,
	);
	await sql`ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS api_key_id text`.execute(
		db,
	);
	await sql`
		CREATE UNIQUE INDEX IF NOT EXISTS subgraphs_name_unique_no_key
		ON subgraphs (name)
		WHERE api_key_id IS NULL
	`.execute(db);
}
