import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * One row per push already sent, so a signal that is seen again never pushes
 * twice. `key` encodes "once per what" (an outage, a stop, a finished
 * replay). Rows are purged after 30 days.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE push_sent (
				account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				key        text NOT NULL,
				kind       text NOT NULL,
				sent_at    timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (account_id, key)
			)
		`.execute(db);
		await sql`
			CREATE INDEX push_sent_sent_at ON push_sent (sent_at)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS push_sent`.execute(db);
	});
}
