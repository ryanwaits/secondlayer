import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * "Talk to us" messages from /contact. Stored first, then emailed to the
 * operator (`CONTACT_NOTIFY_EMAIL`), so nothing is lost when email fails.
 * `notified_at` null means the operator was not emailed (send failed, no
 * Resend key, or no notify address); find those with
 * `WHERE notified_at IS NULL`. `ip_hash` is a sha256 of the client IP,
 * never the address. Control plane, next to `accounts`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE contact_requests (
				id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				name         text NOT NULL,
				email        text NOT NULL,
				company      text,
				volume       text CHECK (volume IN ('lt10m','10m-100m','100m-1b','gt1b','unsure')),
				message      text NOT NULL,
				source_page  text,
				account_id   uuid REFERENCES accounts(id) ON DELETE SET NULL,
				ip_hash      text,
				notified_at  timestamptz,
				created_at   timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE INDEX contact_requests_email_recent_idx
				ON contact_requests (lower(email), created_at DESC)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS contact_requests`.execute(db);
	});
}
