import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `webhook_deliveries.outbox_id` has referenced `webhook_outbox` since 0057
 * (`ON DELETE SET NULL` since 0077) and never had an index. Postgres does
 * not index the referencing side of a foreign key. Deleting an outbox row
 * therefore sequential-scans `webhook_deliveries` to null `outbox_id`.
 *
 * A chain webhook on a high-volume event accumulates ~1e5 outbox rows.
 * `DELETE FROM webhooks` cascades to those rows, and each one scans the
 * whole deliveries heap — including rows already deleted in the same
 * statement, which stay visible until vacuum. That runs past the API's
 * 90s idle timeout: the client gets a 502 and the next attempt queues
 * behind the same lock.
 *
 * `deliveries_sub_idx (webhook_id, dispatched_at)` does not serve
 * `WHERE outbox_id = $1`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS webhook_deliveries_outbox_id_idx
			ON webhook_deliveries (outbox_id)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			DROP INDEX IF EXISTS webhook_deliveries_outbox_id_idx
		`.execute(db);
	});
}
