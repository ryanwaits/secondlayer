import type { Kysely } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("rune_block_digests")
		.addColumn("height", "integer", (col) => col.primaryKey())
		.addColumn("block_hash", "text", (col) => col.notNull())
		.addColumn("digest", "text", (col) => col.notNull())
		.addColumn("event_count", "integer", (col) => col.notNull())
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("rune_block_digests").ifExists().execute();
}
