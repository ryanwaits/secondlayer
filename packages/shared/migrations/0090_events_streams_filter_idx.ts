import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Streams read-path indexes on `events` (chain plane / SOURCE).
 *
 * The Streams firehose filters raw `events` by `data->>'sender'`,
 * `data->>'recipient'`, and `data->>'asset_identifier'` (see
 * `streamsFilterPredicate` in packages/indexer/src/streams-events.ts). Without
 * these the filtered scan is a `Seq Scan on events` over the cursor range —
 * millions of rows on mainnet — and the response window times out. The
 * `(block_height, type)` composite backs both the candidate-row scan and the
 * per-block all-types ordinal CTE that replaces the old per-row correlated
 * COUNT(*).
 *
 * Partial predicate is `(data->>'<field>') IS NOT NULL`, NOT `type IN (...)`:
 * the query filters on equality (`data->>'sender' = $1`), which Postgres can
 * prove implies `IS NOT NULL`, so the index is usable even when the caller
 * filters by sender/recipient WITHOUT a `types=` (a `type IN (transfer types)`
 * predicate would not be provably implied by the unfiltered `type IN (all)`
 * candidate scan, and the planner would skip the index). Keeps the index
 * compact (only rows that carry the field are indexed) while staying usable.
 *
 * `CREATE INDEX CONCURRENTLY` cannot run inside the migrate runner's tx; in
 * prod build these manually with CONCURRENTLY first (matching the index name
 * EXACTLY), then this migration is a no-op there via `IF NOT EXISTS`. On
 * dev/staging the events table is small, so the brief lock is acceptable.
 * `events` is a chain-plane table → DDL no-ops on the control DB under the
 * source/target split.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		// Safety net: a blocking CREATE INDEX on the large prod `events` table
		// exceeds the default statement_timeout (~60s) and aborts the deploy
		// (error 57014). Lift it for THIS migration tx so the build completes.
		// On prod the indexes should still be pre-created CONCURRENTLY (see the
		// header) so this is a no-op via IF NOT EXISTS with no write-lock held;
		// this only saves a fresh deploy where pre-creation was skipped — there
		// the build runs to completion instead of hard-failing the deploy.
		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS events_height_type_idx
			ON events (block_height, type)
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS events_sender_height_idx
			ON events ((data->>'sender'), block_height)
			WHERE (data->>'sender') IS NOT NULL
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS events_recipient_height_idx
			ON events ((data->>'recipient'), block_height)
			WHERE (data->>'recipient') IS NOT NULL
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS events_asset_identifier_height_idx
			ON events ((data->>'asset_identifier'), block_height)
			WHERE (data->>'asset_identifier') IS NOT NULL
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP INDEX IF EXISTS events_asset_identifier_height_idx`.execute(
			db,
		);
		await sql`DROP INDEX IF EXISTS events_recipient_height_idx`.execute(db);
		await sql`DROP INDEX IF EXISTS events_sender_height_idx`.execute(db);
		await sql`DROP INDEX IF EXISTS events_height_type_idx`.execute(db);
	});
}
