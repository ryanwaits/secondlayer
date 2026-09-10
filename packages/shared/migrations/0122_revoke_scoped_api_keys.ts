import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Revoke active scoped `streams`/`index` API keys. Hosted `/v1` accepts
 * `account` keys only (auth-007). The `product` column stays.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			UPDATE api_keys
			SET status = 'revoked', revoked_at = NOW()
			WHERE product IN ('streams', 'index') AND status = 'active'
		`.execute(db);
	});
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// No-op: cannot know which rows were already revoked before this migration.
}
