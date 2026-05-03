import { type Kysely, sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: migration DDL is intentionally schema-dynamic
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("decoded_events")
		.addColumn("cursor", "text", (c) => c.primaryKey())
		.addColumn("block_height", "bigint", (c) => c.notNull())
		.addColumn("tx_id", "text", (c) => c.notNull())
		.addColumn("tx_index", "integer", (c) => c.notNull())
		.addColumn("event_index", "integer", (c) => c.notNull())
		.addColumn("event_type", "text", (c) => c.notNull())
		.addColumn("decoded_payload", "jsonb", (c) => c.notNull())
		.addColumn("source_cursor", "text", (c) => c.notNull())
		.addColumn("created_at", "timestamp", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await db.schema
		.createIndex("decoded_events_block_height_idx")
		.on("decoded_events")
		.column("block_height")
		.execute();
	await db.schema
		.createIndex("decoded_events_event_type_idx")
		.on("decoded_events")
		.column("event_type")
		.execute();

	await db.schema
		.createTable("l2_decoder_checkpoints")
		.addColumn("decoder_name", "text", (c) => c.primaryKey())
		.addColumn("last_cursor", "text")
		.addColumn("updated_at", "timestamp", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: migration DDL is intentionally schema-dynamic
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("l2_decoder_checkpoints").ifExists().execute();
	await db.schema.dropTable("decoded_events").ifExists().execute();
}
