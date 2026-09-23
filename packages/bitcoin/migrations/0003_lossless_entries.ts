import type { Kysely } from "kysely";

// `rune_entries.symbol` (text) and the six `terms_*` columns can't tell
// "field present but empty/zero" apart from "field absent" — a Runestone
// etching's Symbol tag accepts U+0000 (which Postgres text can't store, see
// `symbolForDb`), and its Terms can be present with every field unset (ord:
// `terms: {amount:null,cap:null,height:[null,null],offset:[null,null]}`,
// caught live in the C1 comparison at 841,000 as rune 840257:557). These two
// columns store the fact, not the display value, so `loadState` can rebuild
// the in-memory shape exactly: `symbol_codepoint` is the raw Unicode scalar
// (survives U+0000), `has_terms` is whether `RuneEntry.terms` was ever set at
// all (survives an all-fields-unset `Terms`). `repaired_at` is bookkeeping
// for `cli.ts repair-entries` (plan 040 step 2) — not read by `loadState` —
// marking a row done so a second repair run makes zero RPC calls, including
// for a row whose correctly-repaired values happen to be
// `symbol_codepoint=NULL, has_terms=false` (a plain etching with neither), a
// case a `WHERE symbol_codepoint IS NULL AND NOT has_terms` guard could never
// distinguish from "not yet repaired".
// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("rune_entries")
		.addColumn("symbol_codepoint", "integer")
		.execute();

	await db.schema
		.alterTable("rune_entries")
		.addColumn("has_terms", "boolean", (col) => col.notNull().defaultTo(false))
		.execute();

	await db.schema
		.alterTable("rune_entries")
		.addColumn("repaired_at", "timestamptz")
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("rune_entries")
		.dropColumn("repaired_at")
		.execute();
	await db.schema.alterTable("rune_entries").dropColumn("has_terms").execute();
	await db.schema
		.alterTable("rune_entries")
		.dropColumn("symbol_codepoint")
		.execute();
}
