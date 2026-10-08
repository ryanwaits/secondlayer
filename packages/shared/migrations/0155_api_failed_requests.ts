import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * 24h, account-scoped record of failed hosted API requests (method, path,
 * status, code, short message, redacted query). Written fire-and-forget by
 * the error-envelope middleware and read back as server-side evidence when
 * a caller reports a problem by `request_id`. Purged hourly by the worker.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE api_failed_requests (
				request_id text PRIMARY KEY,
				account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				method     text NOT NULL,
				path       text NOT NULL,
				status     integer NOT NULL,
				code       text NOT NULL,
				message    text NOT NULL DEFAULT '',
				query      jsonb NOT NULL DEFAULT '{}'::jsonb,
				origin     text,
				created_at timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);
		await sql`
			CREATE INDEX api_failed_requests_created_at_idx
				ON api_failed_requests (created_at)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS api_failed_requests`.execute(db);
	});
}
