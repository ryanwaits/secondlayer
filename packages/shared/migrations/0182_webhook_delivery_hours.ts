import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Hourly delivery counts, written when an attempt is recorded, so the webhook
 * activity chart reads at most 720 small rows through the primary key instead
 * of re-scanning `webhook_deliveries` (a month of attempts) on every load.
 *
 * `delivered` counts 2xx attempts, `failed` every other attempt. An AFTER
 * INSERT trigger on `webhook_deliveries` keeps the counts, so every insert
 * site is covered. Deleting deliveries (retention) never decrements them; the
 * emitter's retention sweep drops whole hours instead. Backfilled from the
 * existing deliveries.
 *
 * The trigger upserts one row per insert, by design: the emitter records one
 * attempt per statement. A future bulk insert path should batch its own
 * upsert instead of paying the trigger per row.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE webhook_delivery_hours (
				webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
				hour       timestamptz NOT NULL,
				delivered  integer NOT NULL DEFAULT 0,
				failed     integer NOT NULL DEFAULT 0,
				PRIMARY KEY (webhook_id, hour)
			)
		`.execute(db);
		await sql`
			INSERT INTO webhook_delivery_hours (webhook_id, hour, delivered, failed)
			SELECT
				webhook_id,
				date_trunc('hour', dispatched_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
				count(*) FILTER (WHERE status_code >= 200 AND status_code < 300),
				count(*) FILTER (WHERE NOT coalesce(status_code >= 200 AND status_code < 300, false))
			FROM webhook_deliveries
			GROUP BY 1, 2
		`.execute(db);
		await sql`
			CREATE FUNCTION webhook_delivery_hours_count() RETURNS trigger
			LANGUAGE plpgsql AS $$
			DECLARE
				ok boolean := coalesce(NEW.status_code >= 200 AND NEW.status_code < 300, false);
			BEGIN
				INSERT INTO webhook_delivery_hours (webhook_id, hour, delivered, failed)
				VALUES (
					NEW.webhook_id,
					date_trunc('hour', NEW.dispatched_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
					CASE WHEN ok THEN 1 ELSE 0 END,
					CASE WHEN ok THEN 0 ELSE 1 END
				)
				ON CONFLICT (webhook_id, hour) DO UPDATE SET
					delivered = webhook_delivery_hours.delivered + EXCLUDED.delivered,
					failed = webhook_delivery_hours.failed + EXCLUDED.failed;
				RETURN NULL;
			END
			$$
		`.execute(db);
		await sql`
			CREATE TRIGGER webhook_deliveries_count_hour
			AFTER INSERT ON webhook_deliveries
			FOR EACH ROW EXECUTE FUNCTION webhook_delivery_hours_count()
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TRIGGER IF EXISTS webhook_deliveries_count_hour ON webhook_deliveries`.execute(
			db,
		);
		await sql`DROP FUNCTION IF EXISTS webhook_delivery_hours_count()`.execute(
			db,
		);
		await sql`DROP TABLE IF EXISTS webhook_delivery_hours`.execute(db);
	});
}
