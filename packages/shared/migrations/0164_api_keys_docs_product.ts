import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Docs keys: `api_keys.product = 'docs'`, short-lived (24h) read keys minted
 * for a signed-in reader so code samples can carry their own key. They resolve
 * on the Streams and Index read planes only. `expires_at` is null for every
 * other key. At most one active docs key per account (minting a new one revokes
 * the previous).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz`.execute(
			db,
		);
		await sql`
			ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_product_check
		`.execute(db);
		await sql`
			ALTER TABLE api_keys
				ADD CONSTRAINT api_keys_product_check
				CHECK (product IN ('account', 'streams', 'index', 'sentinel', 'docs'))
		`.execute(db);
		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_active_docs_per_account
				ON api_keys (account_id)
				WHERE status = 'active' AND product = 'docs'
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`DROP INDEX IF EXISTS api_keys_one_active_docs_per_account`.execute(
			db,
		);
		await sql`DELETE FROM api_keys WHERE product = 'docs'`.execute(db);
		await sql`
			ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_product_check
		`.execute(db);
		await sql`
			ALTER TABLE api_keys
				ADD CONSTRAINT api_keys_product_check
				CHECK (product IN ('account', 'streams', 'index', 'sentinel'))
		`.execute(db);
		await sql`ALTER TABLE api_keys DROP COLUMN IF EXISTS expires_at`.execute(
			db,
		);
	});
}
