import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Drop unused subgraphs.database_url_enc. BYO data plane was removed as a
 * deploy path; the column was always written null. Prod had 0 non-null rows.
 * Historical add remains in 0081.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS database_url_enc`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE subgraphs ADD COLUMN IF NOT EXISTS database_url_enc BYTEA`.execute(
			db,
		);
	});
}
