// The two large `rune_events` indexes migration 0005 created — deferred
// during a bulk backfill (plan 089) instead of maintained live. Only the
// `/v1/index/runes` activity-by-address and by-txid reads use them; ingest
// (backfill/follow/flush) never queries `rune_events` by either column, so a
// large backfill drops them first and rebuilds them once, after the load,
// rather than paying random-order btree inserts against a growing table for
// every flush. Definitions here must stay byte-identical to 0005's — see
// that migration's own docstring for why each column/option is there.

import { type Kysely, sql } from "kysely";
import type { Database } from "./types.ts";

/** `runBackfill`'s cutoff (plan 089): a gap larger than this defers these two indexes; a small gap (tip catch-up) leaves them alone. Not a config knob — tests override it via `BackfillOptions.deferIndexThreshold` instead. */
export const DEFER_INDEX_THRESHOLD = 10_000;

interface ReadIndex {
	name: string;
	create: (db: Kysely<Database>) => Promise<void>;
	drop: (db: Kysely<Database>) => Promise<void>;
}

// Identical to migration 0005_read_indexes.ts's `up`/`down` for these two
// indexes — same builder calls, same column lists, same options (none).
const READ_INDEXES: readonly ReadIndex[] = [
	{
		name: "rune_events_address_height_event_index_idx",
		create: (db) =>
			db.schema
				.createIndex("rune_events_address_height_event_index_idx")
				.ifNotExists()
				.on("rune_events")
				.columns(["address", "height", "event_index"])
				.execute()
				.then(() => undefined),
		drop: (db) =>
			db.schema
				.dropIndex("rune_events_address_height_event_index_idx")
				.ifExists()
				.execute()
				.then(() => undefined),
	},
	{
		name: "rune_events_txid_idx",
		create: (db) =>
			db.schema
				.createIndex("rune_events_txid_idx")
				.ifNotExists()
				.on("rune_events")
				.column("txid")
				.execute()
				.then(() => undefined),
		drop: (db) =>
			db.schema
				.dropIndex("rune_events_txid_idx")
				.ifExists()
				.execute()
				.then(() => undefined),
	},
];

/** Drops both deferred indexes if present. Cheap (metadata-only) — no `statement_timeout` override needed, unlike `ensureReadIndexes`. */
export async function dropReadIndexes(db: Kysely<Database>): Promise<void> {
	for (const index of READ_INDEXES) {
		await index.drop(db);
		console.log(`dropReadIndexes: dropped ${index.name} (if it existed)`);
	}
}

/**
 * Creates both deferred indexes if missing — idempotent, safe to call
 * whether or not a backfill actually dropped them (`follow`'s startup calls
 * this unconditionally, see `follow.ts`). Runs in one transaction with
 * `statement_timeout` disabled for it: a full-table index build on
 * `rune_events` routinely exceeds any sane default timeout, the same reason
 * migration 0005 itself disables it.
 */
export async function ensureReadIndexes(db: Kysely<Database>): Promise<void> {
	await db.transaction().execute(async (trx) => {
		await sql`SET LOCAL statement_timeout = 0`.execute(trx);
		for (const index of READ_INDEXES) {
			const start = performance.now();
			console.log(`ensureReadIndexes: building ${index.name}...`);
			await index.create(trx);
			const ms = performance.now() - start;
			console.log(
				`ensureReadIndexes: built ${index.name} in ${ms.toFixed(0)}ms`,
			);
		}
	});
}
