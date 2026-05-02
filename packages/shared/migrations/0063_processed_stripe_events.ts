import { type Kysely, sql } from "kysely";

/**
 * `processed_stripe_events` — webhook idempotency table.
 *
 * Stripe redelivers events on any non-2xx and on its own retry policy.
 * Without dedup, a duplicate `customer.subscription.updated` could
 * double-apply state writes; a late replay of an old `invoice.paid`
 * could clear a current-cycle freeze. We INSERT ON CONFLICT DO NOTHING
 * keyed on `event_id` and bail early if the event has already been
 * processed.
 *
 * Retention: 90 days. Stripe's retry window is shorter, but we keep
 * extra runway for forensics.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE processed_stripe_events (
			event_id TEXT PRIMARY KEY,
			event_type TEXT NOT NULL,
			processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);
	await sql`
		CREATE INDEX processed_stripe_events_processed_at_idx
		ON processed_stripe_events (processed_at)
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS processed_stripe_events`.execute(db);
}
