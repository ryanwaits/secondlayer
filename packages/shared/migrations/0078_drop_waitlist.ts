import type { Kysely } from "kysely";

// Open signup replaced the waitlist gate — the table is no longer read or written.

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("waitlist").ifExists().execute();
}

// Recreates the table as it stood after 0009 + 0010 (no data).
// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("waitlist")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(db.fn("gen_random_uuid")),
		)
		.addColumn("email", "text", (col) => col.notNull().unique())
		.addColumn("source", "text", (col) => col.defaultTo("website"))
		.addColumn("created_at", "timestamptz", (col) =>
			col.notNull().defaultTo(db.fn("now")),
		)
		.addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
		.execute();
}
