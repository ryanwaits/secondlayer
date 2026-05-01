import { type Kysely, sql } from "kysely";

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("workflow_cursors")
		.addColumn("name", "text", (c) => c.primaryKey())
		.addColumn("block_height", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("updated_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("workflow_cursors").execute();
}
