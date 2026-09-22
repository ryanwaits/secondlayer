import { type Kysely, sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: packages/shared/migrations/0078_drop_waitlist.ts)
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("rune_entries")
		.addColumn("rune_id", "text", (col) => col.primaryKey())
		.addColumn("block", sql`numeric(20,0)`, (col) => col.notNull())
		.addColumn("tx", sql`numeric(10,0)`, (col) => col.notNull())
		.addColumn("number", sql`numeric(20,0)`, (col) => col.notNull())
		.addColumn("rune", sql`numeric(39,0)`, (col) => col.notNull())
		.addColumn("spaced_rune", "text", (col) => col.notNull())
		.addColumn("spacers", "integer", (col) => col.notNull())
		.addColumn("divisibility", "integer", (col) => col.notNull())
		.addColumn("symbol", "text")
		.addColumn("premine", sql`numeric(39,0)`, (col) => col.notNull())
		.addColumn("terms_amount", sql`numeric(39,0)`)
		.addColumn("terms_cap", sql`numeric(39,0)`)
		.addColumn("terms_height_start", sql`numeric(20,0)`)
		.addColumn("terms_height_end", sql`numeric(20,0)`)
		.addColumn("terms_offset_start", sql`numeric(20,0)`)
		.addColumn("terms_offset_end", sql`numeric(20,0)`)
		.addColumn("turbo", "boolean", (col) => col.notNull())
		.addColumn("etching_txid", "text", (col) => col.notNull())
		.addColumn("timestamp", sql`numeric(20,0)`, (col) => col.notNull())
		.addColumn("mints", sql`numeric(39,0)`, (col) => col.notNull())
		.addColumn("burned", sql`numeric(39,0)`, (col) => col.notNull())
		.execute();

	await db.schema
		.createTable("rune_balances")
		.addColumn("txid", "text", (col) => col.notNull())
		.addColumn("vout", "integer", (col) => col.notNull())
		.addColumn("rune_id", "text", (col) => col.notNull())
		.addColumn("amount", sql`numeric(39,0)`, (col) => col.notNull())
		.addPrimaryKeyConstraint("rune_balances_pk", ["txid", "vout", "rune_id"])
		.execute();

	await db.schema
		.createTable("rune_events")
		.addColumn("id", "bigserial", (col) => col.primaryKey())
		.addColumn("height", "integer", (col) => col.notNull())
		.addColumn("tx_index", "integer", (col) => col.notNull())
		.addColumn("txid", "text", (col) => col.notNull())
		.addColumn("kind", "text", (col) => col.notNull())
		.addColumn("rune_id", "text", (col) => col.notNull())
		.addColumn("amount", sql`numeric(39,0)`, (col) => col.notNull())
		.addColumn("vout", "integer")
		.addCheckConstraint(
			"rune_events_kind_check",
			sql`kind in ('etch', 'mint', 'transfer', 'burn')`,
		)
		.execute();

	await db.schema
		.createIndex("rune_events_rune_id_height_idx")
		.on("rune_events")
		.columns(["rune_id", "height"])
		.execute();

	await db.schema
		.createTable("btc_blocks")
		.addColumn("height", "integer", (col) => col.primaryKey())
		.addColumn("hash", "text", (col) => col.notNull())
		.execute();

	await db.schema
		.createTable("runes_checkpoint")
		.addColumn("name", "text", (col) => col.primaryKey())
		.addColumn("height", "integer", (col) => col.notNull())
		.addColumn("hash", "text", (col) => col.notNull())
		.addColumn("updated_at", "timestamptz", (col) =>
			col.notNull().defaultTo(db.fn("now")),
		)
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: packages/shared/migrations/0078_drop_waitlist.ts)
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("runes_checkpoint").ifExists().execute();
	await db.schema.dropTable("btc_blocks").ifExists().execute();
	await db.schema.dropTable("rune_events").ifExists().execute();
	await db.schema.dropTable("rune_balances").ifExists().execute();
	await db.schema.dropTable("rune_entries").ifExists().execute();
}
