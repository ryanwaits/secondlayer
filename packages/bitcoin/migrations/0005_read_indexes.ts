import { type Kysely, sql } from "kysely";

// Plan 058 (Runes read API). Indexes + a derived lookup column for the four
// `/v1/index/runes/*` read endpoints — no new tables, this package's ingest
// path (store.ts/entryToRow) is untouched.
//
// `name`: `spaced_rune` with every `•` spacer stripped, so `search=` can
// prefix-match on the plain letters a `RuneRef` name resolves to
// (`dog.go.to.the.moon` / `DOG•GO•TO•THE•MOON` / `doggotothemoon` all
// normalize the same way on the read side — see `packages/api/src/bitcoin/db.ts`
// `parseRuneRef`). A `GENERATED ALWAYS ... STORED` column rather than a plain
// column + app-level backfill: Postgres computes it for every existing row the
// moment the column is added (the migration's own "backfill"), and every future
// insert computes it automatically from `spaced_rune` — no `entryToRow` change,
// so this migration is the only touched file for it, and `name` can never drift
// out of sync with `spaced_rune`. `text_pattern_ops` — not the default btree
// opclass — is what makes `name LIKE 'DOG%'` index-scannable independent of the
// database's collation.
// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createIndex("rune_entries_rune_uidx")
		.on("rune_entries")
		.column("rune")
		.unique()
		.execute();

	await db.schema
		.createIndex("rune_entries_number_idx")
		.on("rune_entries")
		.column("number")
		.execute();

	await db.schema
		.alterTable("rune_entries")
		.addColumn("name", "text", (col) =>
			col.generatedAlwaysAs(sql`replace(spaced_rune, '•', '')`).stored(),
		)
		.execute();

	await sql`
		CREATE INDEX rune_entries_name_prefix_idx
		ON rune_entries (name text_pattern_ops)
	`.execute(db);

	await db.schema
		.createIndex("rune_events_address_height_event_index_idx")
		.on("rune_events")
		.columns(["address", "height", "event_index"])
		.execute();

	await db.schema
		.createIndex("rune_events_txid_idx")
		.on("rune_events")
		.column("txid")
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropIndex("rune_events_txid_idx").ifExists().execute();
	await db.schema
		.dropIndex("rune_events_address_height_event_index_idx")
		.ifExists()
		.execute();
	await db.schema
		.dropIndex("rune_entries_name_prefix_idx")
		.ifExists()
		.execute();
	await db.schema.alterTable("rune_entries").dropColumn("name").execute();
	await db.schema.dropIndex("rune_entries_number_idx").ifExists().execute();
	await db.schema.dropIndex("rune_entries_rune_uidx").ifExists().execute();
}
