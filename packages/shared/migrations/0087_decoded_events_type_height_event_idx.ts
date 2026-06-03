import { type Kysely, sql } from "kysely";

// Composite index backing /v1/index/events keyset pagination for a bare
// event-type source (no contract/sender/recipient filter). The reader paginates
// with `event_type = ? AND (block_height, event_index) > (?, ?)
// ORDER BY block_height, event_index`. Without a leading-event_type composite,
// Postgres bitmap-ANDs the single-column event_type index — re-scanning the
// ENTIRE event-type partition (e.g. ~4.2M `print` rows) on every cursor page,
// turning a backfill into O(n²) (measured ~6.8s/page vs ~50ms for page one).
// With this index each page is an index range scan. Mirrors the existing
// (contract_id|sender|recipient, block_height, event_index) composites that
// already make filtered queries fast.
//
// Already created CONCURRENTLY on prod; IF NOT EXISTS makes this a no-op there
// and a cheap build on fresh/dev databases (small data).
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`CREATE INDEX IF NOT EXISTS decoded_events_type_height_event_idx ON decoded_events (event_type, block_height, event_index) WHERE canonical`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS decoded_events_type_height_event_idx`.execute(
		db,
	);
}
