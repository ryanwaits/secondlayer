import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * The email updates list (new posts and launches). `update_subscribers` is
 * the list: double opt-in (`pending` until the address is confirmed from the
 * emailed link, `confirmed` while subscribed, `unsubscribed` after a
 * one-click opt-out). `token` is the unguessable per-subscriber secret used
 * in confirm and unsubscribe links; `ip_hash` is a sha256 of the client IP,
 * never the address. `update_sends` records which subscriber got which
 * broadcast (`send_key`), so a resumed send never emails anyone twice.
 * Control plane, next to `contact_requests`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE update_subscribers (
				id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				email            text NOT NULL,
				status           text NOT NULL DEFAULT 'pending'
				                 CHECK (status IN ('pending','confirmed','unsubscribed')),
				token            text NOT NULL UNIQUE,
				source_page      text,
				ip_hash          text,
				confirm_sent_at  timestamptz,
				confirmed_at     timestamptz,
				unsubscribed_at  timestamptz,
				created_at       timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE UNIQUE INDEX update_subscribers_email_idx
				ON update_subscribers (lower(email))
		`.execute(db);

		await sql`
			CREATE TABLE update_sends (
				send_key       text NOT NULL,
				subscriber_id  uuid NOT NULL REFERENCES update_subscribers(id) ON DELETE CASCADE,
				sent_at        timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (send_key, subscriber_id)
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS update_sends`.execute(db);
		await sql`DROP TABLE IF EXISTS update_subscribers`.execute(db);
	});
}
