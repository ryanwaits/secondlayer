import { type Kysely, sql } from "kysely";

/**
 * Loosen `subscription_deliveries.outbox_id` FK from `ON DELETE CASCADE` to
 * `ON DELETE SET NULL` so phantom outbox deletes (cleanup races, manual
 * requeue, subscription delete mid-dispatch) don't 23503 the delivery
 * insert and snowball into auto-paused subscriptions via the circuit
 * breaker.
 *
 * Delivery rows are append-only telemetry; the subscription_id column is
 * the load-bearing reference. Losing the outbox link on a small minority of
 * rows is preferable to losing the entire delivery record.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE subscription_deliveries
			ALTER COLUMN outbox_id DROP NOT NULL
	`.execute(db);

	await sql`
		ALTER TABLE subscription_deliveries
			DROP CONSTRAINT IF EXISTS subscription_deliveries_outbox_id_fkey
	`.execute(db);

	await sql`
		ALTER TABLE subscription_deliveries
			ADD CONSTRAINT subscription_deliveries_outbox_id_fkey
			FOREIGN KEY (outbox_id) REFERENCES subscription_outbox(id)
			ON DELETE SET NULL
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE subscription_deliveries
			DROP CONSTRAINT IF EXISTS subscription_deliveries_outbox_id_fkey
	`.execute(db);

	await sql`
		ALTER TABLE subscription_deliveries
			ADD CONSTRAINT subscription_deliveries_outbox_id_fkey
			FOREIGN KEY (outbox_id) REFERENCES subscription_outbox(id)
			ON DELETE CASCADE
	`.execute(db);

	await sql`
		ALTER TABLE subscription_deliveries
			ALTER COLUMN outbox_id SET NOT NULL
	`.execute(db);
}
