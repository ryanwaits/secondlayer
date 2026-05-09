import { type Kysely, sql } from "kysely";

/**
 * Expression index on `events.data->>'contract_identifier'` for the print
 * event types. Without this, BNS-style consumers that filter prints by
 * contract scan every print row in the cursor range — millions of rows on
 * mainnet — and the response window times out.
 *
 * Already applied to prod 2026-05-09 via `CREATE INDEX CONCURRENTLY`. This
 * migration is a no-op there (IF NOT EXISTS) and seeds dev/staging. The
 * migrate runner wraps each migration in a tx, so CONCURRENTLY can't be
 * used here — we accept a brief lock on dev/staging where the events table
 * is small.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE INDEX IF NOT EXISTS events_contract_event_contract_id_idx
		ON events ((data->>'contract_identifier'), block_height)
		WHERE type IN ('smart_contract_event', 'contract_event')
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS events_contract_event_contract_id_idx`.execute(
		db,
	);
}
