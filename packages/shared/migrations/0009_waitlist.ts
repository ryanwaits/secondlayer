import type { Kysely } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
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
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("waitlist").execute();
}
