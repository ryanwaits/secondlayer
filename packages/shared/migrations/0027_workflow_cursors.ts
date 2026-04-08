import { sql, type Kysely } from "kysely";

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

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("workflow_cursors").execute();
}
