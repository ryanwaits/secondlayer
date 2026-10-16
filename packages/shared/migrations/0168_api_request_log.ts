import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * 7-day, account-scoped log of Index and Streams reads (path template,
 * hashed parameters and cursor, page size, rows served, status, duration).
 * Evidence for dashboard usage insights: repeated page sequences, polling
 * loops, errors by path. Written fire-and-forget by the request-log
 * middleware; purged hourly by the worker.
 *
 * Privacy: query values and cursors are stored only as short hashes. No
 * bodies, headers, IPs or tokens are ever stored.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE api_request_log (
				id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				request_id    text,
				account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				api_key_id    uuid,
				method        text NOT NULL,
				path          text NOT NULL,
				path_template text NOT NULL,
				params_hash   text,
				cursor_hash   text,
				page_size     integer,
				rows          integer,
				status        integer NOT NULL,
				duration_ms   integer NOT NULL,
				created_at    timestamptz NOT NULL DEFAULT now()
			)
		`.execute(db);
		await sql`
			CREATE INDEX api_request_log_account_created_idx
				ON api_request_log (account_id, created_at)
		`.execute(db);
		await sql`
			CREATE INDEX api_request_log_created_at_idx
				ON api_request_log (created_at)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS api_request_log`.execute(db);
	});
}
