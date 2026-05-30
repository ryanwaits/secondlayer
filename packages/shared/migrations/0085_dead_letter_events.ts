import { type Kysely, sql } from "kysely";

// Dead-letter capture for events whose decoded payload fails schema validation
// on ingest (see STREAMS_PAYLOAD_VALIDATION). The event itself is still written
// to `events` — chain data is never dropped — so this is an append-only
// diagnostic log of malformed payloads, queryable by height and reason.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`
		CREATE TABLE IF NOT EXISTS dead_letter_events (
			id BIGSERIAL PRIMARY KEY,
			block_height BIGINT NOT NULL,
			tx_id TEXT NOT NULL,
			event_index INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			data JSONB,
			reason TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS dead_letter_events_height_idx ON dead_letter_events (block_height)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS dead_letter_events_reason_idx ON dead_letter_events (reason)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS dead_letter_events`.execute(db);
}
