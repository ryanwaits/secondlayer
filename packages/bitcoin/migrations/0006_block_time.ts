import type { Kysely } from "kysely";

// Block header time (unix seconds) per stored block, so Streams events can
// carry `ts`. Nullable: adding it is metadata-only (fast on a large table),
// new blocks write it in `flush`, and `repair-block-times` fills older rows
// from the node's block headers.
// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("btc_blocks")
		.addColumn("time", "integer")
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic (pattern: migrations/0001_runes.ts)
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.alterTable("btc_blocks").dropColumn("time").execute();
}
