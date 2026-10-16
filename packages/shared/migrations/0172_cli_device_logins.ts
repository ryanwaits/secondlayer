import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Browser sign-in for the CLI (`sl login`). One row per attempt: the CLI
 * creates a `pending` row and shows the short `user_code`; a signed-in user
 * approves it in the browser (`approved`, with the account and the name for the
 * key); the CLI's next poll mints the key and flips the row to `consumed`, so
 * the plaintext key is never stored. Only a hash of the CLI's secret
 * `device_code` is kept. Rows are short-lived (15 minutes).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE cli_device_logins (
				id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				device_code_hash text NOT NULL UNIQUE,
				user_code        text NOT NULL UNIQUE,
				client_name      text NOT NULL,
				status           text NOT NULL DEFAULT 'pending'
					CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
				account_id       uuid REFERENCES accounts(id) ON DELETE CASCADE,
				key_name         text,
				created_at       timestamptz NOT NULL DEFAULT now(),
				expires_at       timestamptz NOT NULL,
				approved_at      timestamptz,
				consumed_at      timestamptz
			)
		`.execute(db);
		await sql`
			CREATE INDEX cli_device_logins_expires
				ON cli_device_logins (expires_at)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS cli_device_logins`.execute(db);
	});
}
