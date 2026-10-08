import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Hosted problem reports filed by agents at `POST /v1/feedback`. `attempted`
 * is copied from `api_failed_requests` by the server, never taken from the
 * caller. `status` starts `new`; the classify worker moves it to
 * `classified` and fills `route` / `classification`. One idempotency key per
 * account de-duplicates retries (NULL keys are always distinct).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE feedback_tickets (
				id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				idempotency_key text,
				request_id      text,
				intent          text NOT NULL,
				expected        jsonb,
				kind_hint       text,
				evidence        jsonb,
				attempted       jsonb,
				origin          text NOT NULL,
				status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'classified')),
				route           text,
				classification  jsonb,
				classified_at   timestamptz,
				created_at      timestamptz NOT NULL DEFAULT now(),
				UNIQUE (account_id, idempotency_key)
			)
		`.execute(db);

		await sql`
			CREATE INDEX feedback_tickets_new_idx
				ON feedback_tickets (created_at) WHERE status = 'new'
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS feedback_tickets`.execute(db);
	});
}
