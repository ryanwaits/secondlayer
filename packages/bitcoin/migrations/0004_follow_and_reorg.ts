import { type Kysely, sql } from "kysely";

// Plan 057 (tip following + reorg survival), items 1–4. This migration only
// ever runs against an empty `rune_events`/`rune_balances` (the plan forces a
// full rebuild from 840,000 — the derived columns below can't be
// back-filled without re-deriving from every block), so `event_index` can be
// `NOT NULL` with no default.
//
// event_index: this event's position within its block, in the digest chain's
// own canonical order (`../src/integrity/digest.ts`'s `compareEvents`) — the
// `<height>:<n>` cursor shape (`packages/shared/src/streams-cursor.ts`) needs
// a stable per-block ordinal, which `rune_events.id` (insertion order, not
// canonical order) doesn't provide. Derived at flush time; kept out of the
// digest chain itself (`serializeEvent`), so `d_H` is unaffected.
//
// address: the output's mainnet address (`../src/address.ts`), for the one
// event kind that lands on a specific output (`transfer`) and for a live
// balance's outpoint. Nullable — a non-standard scriptPubKey has none. This
// is not general UTXO/address indexing (PRODUCT.md line 64): only
// rune-bearing outputs ever get a row here.
// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("rune_events")
		.addColumn("event_index", "integer", (col) => col.notNull())
		.execute();

	await db.schema
		.createIndex("rune_events_height_event_index_uidx")
		.on("rune_events")
		.columns(["height", "event_index"])
		.unique()
		.execute();

	await db.schema
		.createIndex("rune_events_height_idx")
		.on("rune_events")
		.column("height")
		.execute();

	await db.schema
		.alterTable("rune_events")
		.addColumn("address", "text")
		.execute();

	await db.schema
		.alterTable("rune_balances")
		.addColumn("address", "text")
		.execute();

	await db.schema
		.createIndex("rune_balances_address_idx")
		.on("rune_balances")
		.column("address")
		.execute();

	// D10: per-block undo journal, kept ≥12 blocks deep (`UNDO_DEPTH`,
	// `../src/runes/undo.ts`) while following the tip (`flush`'s
	// `undoSnapshotBeforeBlock` option, one block per flush) — enough to
	// reverse a shallow reorg; a deeper one halts ingest (fail closed), never
	// raises this depth. `payload` holds everything `../src/rewind.ts`'s
	// `rewindTo` needs to reverse the block: pre-block balances at every
	// touched outpoint, which touched pairs had no pre-block balance (deleted
	// on rewind, not restored), which rune IDs were etched this block
	// (deleted entirely on rewind), and pre-block `mints`/`burned` for every
	// pre-existing rune this block touched.
	await db.schema
		.createTable("rune_undo")
		.addColumn("height", "integer", (col) => col.primaryKey())
		.addColumn("block_hash", "text", (col) => col.notNull())
		.addColumn("payload", "jsonb", (col) => col.notNull())
		.execute();

	// Same fields as the Stacks `ChainReorgRecord`
	// (`packages/shared/src/db/queries/chain-reorgs.ts`), so plan 059 can serve
	// this table as `reorgs` without a shape translation.
	await db.schema
		.createTable("btc_reorgs")
		.addColumn("id", "bigserial", (col) => col.primaryKey())
		.addColumn("detected_at", "timestamptz", (col) =>
			col.notNull().defaultTo(sql`now()`),
		)
		.addColumn("fork_point_height", "integer", (col) => col.notNull())
		.addColumn("old_hash", "text", (col) => col.notNull())
		.addColumn("new_hash", "text", (col) => col.notNull())
		.addColumn("orphaned_from", "integer", (col) => col.notNull())
		.addColumn("orphaned_to", "integer", (col) => col.notNull())
		.addColumn("new_tip_height", "integer", (col) => col.notNull())
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("btc_reorgs").ifExists().execute();
	await db.schema.dropTable("rune_undo").ifExists().execute();

	await db.schema.dropIndex("rune_balances_address_idx").ifExists().execute();
	await db.schema.alterTable("rune_balances").dropColumn("address").execute();

	await db.schema.alterTable("rune_events").dropColumn("address").execute();
	await db.schema.dropIndex("rune_events_height_idx").ifExists().execute();
	await db.schema
		.dropIndex("rune_events_height_event_index_uidx")
		.ifExists()
		.execute();
	await db.schema.alterTable("rune_events").dropColumn("event_index").execute();
}
