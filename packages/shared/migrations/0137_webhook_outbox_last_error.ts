import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `webhook_outbox.last_error` — text, nullable. Lets a reorg record WHY a
 * row was marked `dead` ("orphaned by reorg at <fork>") without overloading
 * `webhooks.last_error`, which tracks the sub's own delivery-failure history,
 * not a per-row outcome.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE webhook_outbox
			ADD COLUMN IF NOT EXISTS last_error TEXT
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`ALTER TABLE webhook_outbox DROP COLUMN IF EXISTS last_error`.execute(
			db,
		);
	});
}
