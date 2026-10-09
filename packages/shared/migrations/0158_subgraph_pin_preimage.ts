import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `subgraphs.pin_preimage`: the canonical JSON `pin` is the sha256 of
 * (handler hash, network, runtime, schema hash, startBlock). Network and
 * runtime are stored nowhere else, so without it a client cannot recompute
 * the pin. NULL for unbundled deploys and rows deployed before this column.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS pin_preimage TEXT
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS pin_preimage`.execute(
			db,
		);
	});
}
