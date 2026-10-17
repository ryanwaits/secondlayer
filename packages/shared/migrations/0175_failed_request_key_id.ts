import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * The key a failed request presented, when there was one we know: today only
 * a revoked account key (`KEY_REVOKED`), so the account can see which revoked
 * key is still being called. Nullable, no FK: rows live 24h.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE api_failed_requests ADD COLUMN IF NOT EXISTS api_key_id uuid
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE api_failed_requests DROP COLUMN IF EXISTS api_key_id`.execute(
			db,
		);
	});
}
