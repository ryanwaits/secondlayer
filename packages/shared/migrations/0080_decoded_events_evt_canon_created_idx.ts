import { type Kysely, sql } from "kysely";

// Composite index backing the l2-decoder /health freshness probe
// (`readLatestDecodedAt`): `WHERE event_type = ? AND canonical = ?
// ORDER BY created_at DESC LIMIT 1`. Without it that query seq-scans the
// full decoded_events table (~18GB) and sorts millions of rows per call;
// /health fans it out per decoder, so under load Postgres pinned several
// cores. With this index it's an instant index-only scan.
//
// Already created CONCURRENTLY on prod; IF NOT EXISTS makes this a no-op
// there and a cheap build on fresh/dev databases (small data).
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`CREATE INDEX IF NOT EXISTS decoded_events_evt_canon_created_idx ON decoded_events (event_type, canonical, created_at DESC)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS decoded_events_evt_canon_created_idx`.execute(
		db,
	);
}
