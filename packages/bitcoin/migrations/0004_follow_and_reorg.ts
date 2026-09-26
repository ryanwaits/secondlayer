import type { Kysely } from "kysely";

// Plan 057 (tip following + reorg survival), items 1–2. This migration only
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
}

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function down(db: Kysely<any>): Promise<void> {
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
