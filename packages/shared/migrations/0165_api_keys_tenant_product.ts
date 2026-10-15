import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Tenant keys: `api_keys.product = 'tenant'`, the keys the workload host mints
 * for a hosted tenant stack (`POST /internal/keys/tenant`). They read Streams
 * and Index like an account key, and they are the only keys the hosted
 * chain-read route (`/v1/chain-read`) accepts. They never open account routes.
 *
 * Existing tenant keys move over by provenance, never by name (a customer can
 * name a key anything): the internal route is the only writer of
 * `ip_address = 'workload-host'`; a customer key carries the client IP the
 * trusted proxy saw. The workload host's tenant rows store no key id, so
 * provenance is the strongest signal this database holds.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_product_check
		`.execute(db);
		await sql`
			ALTER TABLE api_keys
				ADD CONSTRAINT api_keys_product_check
				CHECK (product IN ('account', 'streams', 'index', 'sentinel', 'docs', 'tenant'))
		`.execute(db);
		await sql`
			UPDATE api_keys SET product = 'tenant'
			WHERE ip_address = 'workload-host' AND product = 'account'
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			UPDATE api_keys SET product = 'account' WHERE product = 'tenant'
		`.execute(db);
		await sql`
			ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_product_check
		`.execute(db);
		await sql`
			ALTER TABLE api_keys
				ADD CONSTRAINT api_keys_product_check
				CHECK (product IN ('account', 'streams', 'index', 'sentinel', 'docs'))
		`.execute(db);
	});
}
