import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `webhook_outbox.block_time` — timestamptz, nullable. The evaluator fills it
 * from the block a row's matched event/tx belongs to. `webhook_outbox` lives
 * on the TARGET (control-plane) DB, which can't join back to the SOURCE-plane
 * `blocks` table, so the block's timestamp has to be copied over at write time
 * to compute `delivered_at - block_time` (end-to-end webhook latency) later.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE webhook_outbox
			ADD COLUMN IF NOT EXISTS block_time TIMESTAMPTZ
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`ALTER TABLE webhook_outbox DROP COLUMN IF EXISTS block_time`.execute(
			db,
		);
	});
}
