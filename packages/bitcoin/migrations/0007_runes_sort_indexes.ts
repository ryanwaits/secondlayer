import { type Kysely, sql } from "kysely";

// Keyset indexes for two `/v1/index/runes` reads (`packages/api/src/index/runes.ts`):
// `sort=mints` pages on `(mints, number) < (...) ORDER BY mints DESC, number DESC`,
// and `balances?address=` pages on `(rune_id, txid, vout) > (...)` ordered the
// same way under an `address =` filter. `rune_balances_address_idx` (0004) is a
// strict prefix of the new balances index, so it is dropped only after the
// replacement exists. Runs inside the migrator's transaction like 0005, so a
// failed build rolls back with no INVALID index left behind.
// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function up(db: Kysely<any>): Promise<void> {
	// Index builds over the full rune_balances table exceed the migrator's 60s default.
	await sql`SET LOCAL statement_timeout = 0`.execute(db);

	await sql`
		CREATE INDEX IF NOT EXISTS rune_entries_mints_number_idx
		ON rune_entries (mints DESC, number DESC)
	`.execute(db);

	await db.schema
		.createIndex("rune_balances_address_keyset_idx")
		.ifNotExists()
		.on("rune_balances")
		.columns(["address", "rune_id", "txid", "vout"])
		.execute();

	await db.schema.dropIndex("rune_balances_address_idx").ifExists().execute();
}

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function down(db: Kysely<any>): Promise<void> {
	await sql`SET LOCAL statement_timeout = 0`.execute(db);

	await db.schema
		.dropIndex("rune_entries_mints_number_idx")
		.ifExists()
		.execute();

	await db.schema
		.createIndex("rune_balances_address_idx")
		.ifNotExists()
		.on("rune_balances")
		.column("address")
		.execute();

	await db.schema
		.dropIndex("rune_balances_address_keyset_idx")
		.ifExists()
		.execute();
}
