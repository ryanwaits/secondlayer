import type { Kysely } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable("waitlist")
		.addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.alterTable("waitlist").dropColumn("status").execute();
}
