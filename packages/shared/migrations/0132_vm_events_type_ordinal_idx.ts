import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/** Index seek: (event_type, block_height, ordinal). */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS vm_events_type_height_ordinal_idx
			ON vm_events (type, block_height, ordinal)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP INDEX IF EXISTS vm_events_type_height_ordinal_idx`.execute(
			db,
		);
	});
}
