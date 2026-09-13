import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Rename the subscription plane to webhooks. Control plane only — these tables
 * live on TARGET (`TABLE_TO_DB`). In-place RENAME, no data copy.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`ALTER TABLE subscriptions RENAME TO webhooks`.execute(db);
		await sql`ALTER TABLE subscription_outbox RENAME TO webhook_outbox`.execute(
			db,
		);
		await sql`ALTER TABLE subscription_deliveries RENAME TO webhook_deliveries`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox RENAME COLUMN subscription_id TO webhook_id`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_deliveries RENAME COLUMN subscription_id TO webhook_id`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks RENAME CONSTRAINT subscriptions_kind_shape TO webhooks_kind_shape`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_deliveries RENAME CONSTRAINT subscription_deliveries_outbox_id_fkey TO webhook_deliveries_outbox_id_fkey`.execute(
			db,
		);
		await sql`ALTER INDEX subscriptions_account_idx RENAME TO webhooks_account_idx`.execute(
			db,
		);
		await sql`ALTER INDEX subscriptions_matcher_idx RENAME TO webhooks_matcher_idx`.execute(
			db,
		);
		await sql`ALTER INDEX subscription_outbox_chain_height_idx RENAME TO webhook_outbox_chain_height_idx`.execute(
			db,
		);
		await sql`ALTER TRIGGER subscription_outbox_notify ON webhook_outbox RENAME TO webhook_outbox_notify`.execute(
			db,
		);
		await sql`
			CREATE OR REPLACE FUNCTION notify_new_outbox() RETURNS TRIGGER AS $$
			BEGIN
				PERFORM pg_notify('webhooks:new_outbox', NEW.webhook_id::text);
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`ALTER TRIGGER webhook_outbox_notify ON webhook_outbox RENAME TO subscription_outbox_notify`.execute(
			db,
		);
		await sql`ALTER INDEX webhook_outbox_chain_height_idx RENAME TO subscription_outbox_chain_height_idx`.execute(
			db,
		);
		await sql`ALTER INDEX webhooks_matcher_idx RENAME TO subscriptions_matcher_idx`.execute(
			db,
		);
		await sql`ALTER INDEX webhooks_account_idx RENAME TO subscriptions_account_idx`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_deliveries RENAME CONSTRAINT webhook_deliveries_outbox_id_fkey TO subscription_deliveries_outbox_id_fkey`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks RENAME CONSTRAINT webhooks_kind_shape TO subscriptions_kind_shape`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_deliveries RENAME COLUMN webhook_id TO subscription_id`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox RENAME COLUMN webhook_id TO subscription_id`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_deliveries RENAME TO subscription_deliveries`.execute(
			db,
		);
		await sql`ALTER TABLE webhook_outbox RENAME TO subscription_outbox`.execute(
			db,
		);
		await sql`ALTER TABLE webhooks RENAME TO subscriptions`.execute(db);
		await sql`
			CREATE OR REPLACE FUNCTION notify_new_outbox() RETURNS TRIGGER AS $$
			BEGIN
				PERFORM pg_notify('subscriptions:new_outbox', NEW.subscription_id::text);
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql
		`.execute(db);
	});
}
