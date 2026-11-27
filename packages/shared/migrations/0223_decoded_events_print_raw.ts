import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		await sql`
			ALTER TABLE decoded_events ADD COLUMN IF NOT EXISTS raw_value BYTEA
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`ALTER TABLE decoded_events DROP COLUMN IF EXISTS raw_value`.execute(
			db,
		);
	});
}
