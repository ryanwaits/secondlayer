import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Sentinel agent keys: `api_keys.product = 'sentinel'` plus nullable `areas`
 * jsonb holding Sentinel's permission areas (`{plans, monitoring, alerts}`,
 * each none|read|write). Only `/internal/sentinel/keys` mints them; they
 * authenticate nothing on secondlayer itself (hosted /v1 and `requireAuth`
 * accept `account` keys only), Sentinel resolves them server-to-server.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS areas jsonb`.execute(
			db,
		);
		await sql`
			ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_product_check
		`.execute(db);
		await sql`
			ALTER TABLE api_keys
				ADD CONSTRAINT api_keys_product_check
				CHECK (product IN ('account', 'streams', 'index', 'sentinel'))
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`DELETE FROM api_keys WHERE product = 'sentinel'`.execute(db);
		await sql`
			ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_product_check
		`.execute(db);
		await sql`
			ALTER TABLE api_keys
				ADD CONSTRAINT api_keys_product_check
				CHECK (product IN ('account', 'streams', 'index'))
		`.execute(db);
		await sql`ALTER TABLE api_keys DROP COLUMN IF EXISTS areas`.execute(db);
	});
}
