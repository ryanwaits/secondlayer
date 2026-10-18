import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Which product started a CLI sign-in: null for `sl login`, `sentinel` for
 * `sentinel login`. The approval page names the product, and approving a
 * Sentinel sign-in links the account to Sentinel. A CHECK keeps it to known
 * products, never requester-chosen text.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE cli_device_logins ADD COLUMN IF NOT EXISTS product text
				CHECK (product IN ('sentinel'))
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE cli_device_logins DROP COLUMN IF EXISTS product`.execute(
			db,
		);
	});
}
