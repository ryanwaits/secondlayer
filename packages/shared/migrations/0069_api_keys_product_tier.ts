import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`
		ALTER TABLE api_keys
			ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'account',
			ADD COLUMN IF NOT EXISTS tier text
	`.execute(db);

	await sql`
		ALTER TABLE api_keys
			ADD CONSTRAINT api_keys_product_check
			CHECK (product IN ('account', 'streams', 'index'))
	`.execute(db);

	await sql`
		ALTER TABLE api_keys
			ADD CONSTRAINT api_keys_tier_check
			CHECK (tier IS NULL OR tier IN ('free', 'build', 'scale', 'enterprise'))
	`.execute(db);

	await sql`
		CREATE INDEX IF NOT EXISTS api_keys_product_status_idx
			ON api_keys (product, status)
			WHERE status = 'active'
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS api_keys_product_status_idx`.execute(db);
	await sql`
		ALTER TABLE api_keys
			DROP CONSTRAINT IF EXISTS api_keys_product_check,
			DROP CONSTRAINT IF EXISTS api_keys_tier_check
	`.execute(db);
	await sql`
		ALTER TABLE api_keys
			DROP COLUMN IF EXISTS product,
			DROP COLUMN IF EXISTS tier
	`.execute(db);
}
