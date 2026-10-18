import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * One stored record per webhook replay, so a replay can be watched (queued,
 * delivering N of M, done) and what gave up can be requeued. The partial
 * unique index lets the database, not process memory, enforce "one replay
 * scanning per webhook at a time".
 *
 * `webhook_outbox.replay_id` links outbox rows to their replay. It is a
 * nullable column with no default (instant) and deliberately has NO index:
 * building one on the large, hot outbox would block delivery inserts on every
 * hosted stack. Progress counts use the existing partial index on pending rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE webhook_replays (
				id             text PRIMARY KEY,
				webhook_id     uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
				from_block     bigint NOT NULL,
				to_block       bigint NOT NULL,
				status         text NOT NULL CHECK (status IN ('scanning','running','done','failed')),
				scanned_count  integer NOT NULL DEFAULT 0,
				enqueued_count integer NOT NULL DEFAULT 0,
				total          integer,
				delivered      integer,
				gave_up        integer,
				error          text,
				started_at     timestamptz NOT NULL DEFAULT now(),
				finished_at    timestamptz
			)
		`.execute(db);
		await sql`
			CREATE UNIQUE INDEX webhook_replays_one_scanning
				ON webhook_replays (webhook_id)
				WHERE status = 'scanning'
		`.execute(db);
		await sql`
			CREATE INDEX webhook_replays_webhook_started
				ON webhook_replays (webhook_id, started_at DESC)
		`.execute(db);
		await sql`
			ALTER TABLE webhook_outbox ADD COLUMN IF NOT EXISTS replay_id text
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE webhook_outbox DROP COLUMN IF EXISTS replay_id`.execute(
			db,
		);
		await sql`DROP TABLE IF EXISTS webhook_replays`.execute(db);
	});
}
