import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Hides an open insight until this time ("Until tomorrow" on the phone).
 * Survives re-fires, like `dismissed_at`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE insights ADD COLUMN IF NOT EXISTS snoozed_until timestamptz
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE insights DROP COLUMN IF EXISTS snoozed_until`.execute(
			db,
		);
	});
}
