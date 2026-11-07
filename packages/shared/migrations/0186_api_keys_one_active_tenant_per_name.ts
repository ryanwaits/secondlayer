import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * At most one active tenant key per (account, name): the workload host
 * rotates its `hosted-stack` key by revoking and minting in one transaction,
 * and this index makes a second active copy impossible instead of unlikely.
 *
 * A database that already holds duplicates keeps only the newest active key
 * of each pair, the one the host last minted.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			UPDATE api_keys SET status = 'revoked', revoked_at = now()
			WHERE product = 'tenant' AND status = 'active' AND id IN (
				SELECT id FROM (
					SELECT id, row_number() OVER (
						PARTITION BY account_id, name ORDER BY created_at DESC, id DESC
					) AS rank
					FROM api_keys
					WHERE product = 'tenant' AND status = 'active'
				) ranked
				WHERE rank > 1
			)
		`.execute(db);
		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_active_tenant_per_name
				ON api_keys (account_id, name)
				WHERE product = 'tenant' AND status = 'active'
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`DROP INDEX IF EXISTS api_keys_one_active_tenant_per_name`.execute(
			db,
		);
	});
}
