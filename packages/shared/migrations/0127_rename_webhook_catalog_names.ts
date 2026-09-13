import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Finish the 0126 table rename: Postgres keeps the original auto-generated
 * constraint/index names (`subscriptions_pkey`, …) across ALTER TABLE RENAME.
 * Control plane only. In-place RENAME CONSTRAINT, no data copy.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`ALTER TABLE webhooks RENAME CONSTRAINT subscriptions_pkey TO webhooks_pkey`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks RENAME CONSTRAINT subscriptions_account_id_name_key TO webhooks_account_id_name_key`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox RENAME CONSTRAINT subscription_outbox_pkey TO webhook_outbox_pkey`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox RENAME CONSTRAINT subscription_outbox_subscription_id_fkey TO webhook_outbox_webhook_id_fkey`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox RENAME CONSTRAINT subscription_outbox_subscription_id_dedup_key_key TO webhook_outbox_webhook_id_dedup_key_key`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_deliveries RENAME CONSTRAINT subscription_deliveries_pkey TO webhook_deliveries_pkey`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`ALTER TABLE webhook_deliveries RENAME CONSTRAINT webhook_deliveries_pkey TO subscription_deliveries_pkey`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox RENAME CONSTRAINT webhook_outbox_webhook_id_dedup_key_key TO subscription_outbox_subscription_id_dedup_key_key`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox RENAME CONSTRAINT webhook_outbox_webhook_id_fkey TO subscription_outbox_subscription_id_fkey`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox RENAME CONSTRAINT webhook_outbox_pkey TO subscription_outbox_pkey`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks RENAME CONSTRAINT webhooks_account_id_name_key TO subscriptions_account_id_name_key`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks RENAME CONSTRAINT webhooks_pkey TO subscriptions_pkey`.execute(
			db,
		);
	});
}
