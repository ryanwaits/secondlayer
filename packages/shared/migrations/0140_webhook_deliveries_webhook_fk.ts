import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `webhook_deliveries.webhook_id` has carried no FK since the table was
 * created (0057, as `subscription_deliveries`) — only `outbox_id` got one
 * (0077, `ON DELETE SET NULL`, kept on purpose: delivery history outlives
 * outbox compaction). Deleting a webhook left its delivery history orphaned
 * (1,186 rows had built up in the CI-mirror DB); the dashboard/API never
 * show them, so they just sat there until the 30-day retention sweep.
 *
 * `deliveries_sub_idx (webhook_id, dispatched_at DESC)` already covers the
 * cascade lookup — it predates this migration (0057) and survived the
 * 0126 rename under its old name, so no new index is needed here.
 *
 * `webhook_deliveries` lives on the TARGET (control-plane) DB alongside
 * `webhooks`, like `webhook_outbox` — gate with `onControlPlane`, same as
 * 0139.
 *
 * NOT VALID + a separate VALIDATE keeps the exclusive lock short on a big
 * table: NOT VALID only takes the fast lock to add the constraint (new rows
 * are checked immediately), then VALIDATE scans existing rows without
 * blocking writers the whole time.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		const existing = await sql<{ exists: boolean }>`
			SELECT EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'webhook_deliveries_webhook_id_fkey'
			) AS exists
		`.execute(db);
		if (existing.rows[0]?.exists) return;

		await sql`
			DELETE FROM webhook_deliveries d
			WHERE NOT EXISTS (SELECT 1 FROM webhooks w WHERE w.id = d.webhook_id)
		`.execute(db);

		await sql`
			ALTER TABLE webhook_deliveries
			ADD CONSTRAINT webhook_deliveries_webhook_id_fkey
				FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
				NOT VALID
		`.execute(db);

		await sql`
			ALTER TABLE webhook_deliveries
			VALIDATE CONSTRAINT webhook_deliveries_webhook_id_fkey
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		// Deleted orphans are not restored.
		await sql`
			ALTER TABLE webhook_deliveries
			DROP CONSTRAINT IF EXISTS webhook_deliveries_webhook_id_fkey
		`.execute(db);
	});
}
