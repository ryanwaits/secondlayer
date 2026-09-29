import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Which accounts Sentinel's service key may touch. A row exists only for an
 * account Sentinel created (`via = 'created'`) or one whose owner opted in
 * from Sentinel's UI (`via = 'consent'`). Every `/internal/sentinel/*` call
 * (and Sentinel-key `/internal/meters` items) beyond resolve/link requires a
 * row, so a leaked key can't spend from or credit an arbitrary account.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE sentinel_accounts (
				account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
				linked_at  timestamptz NOT NULL DEFAULT now(),
				via        text NOT NULL CHECK (via IN ('created', 'consent'))
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS sentinel_accounts`.execute(db);
	});
}
