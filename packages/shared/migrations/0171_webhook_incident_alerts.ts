import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Debounce state for the "webhook can't reach your server" email
 * (`POST /internal/webhook-incidents`). One row per incident: opened when the
 * workload host first reports a webhook as down, resolved when a later report
 * no longer lists it (recovered or deleted). The partial unique index keeps at
 * most one open incident per webhook, so repeated reports never re-send.
 * `emailed_at` is set after the account's email goes out;
 * `email_attempts` bounds retries of a failing send. There are no
 * preference columns on purpose: the alert has no settings.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE webhook_incident_alerts (
				id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				webhook_id    text NOT NULL,
				webhook_name  text NOT NULL,
				failing_since timestamptz NOT NULL,
				opened_at     timestamptz NOT NULL DEFAULT now(),
				emailed_at    timestamptz,
				email_attempts integer NOT NULL DEFAULT 0,
				resolved_at   timestamptz
			)
		`.execute(db);
		await sql`
			CREATE UNIQUE INDEX webhook_incident_alerts_open
				ON webhook_incident_alerts (account_id, webhook_id)
				WHERE resolved_at IS NULL
		`.execute(db);
		await sql`
			CREATE INDEX webhook_incident_alerts_resolved
				ON webhook_incident_alerts (resolved_at)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS webhook_incident_alerts`.execute(db);
	});
}
