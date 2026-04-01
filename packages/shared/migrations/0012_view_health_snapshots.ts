import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("view_health_snapshots")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(db.fn("gen_random_uuid")),
		)
		.addColumn("view_id", "uuid", (col) =>
			col.notNull().references("views.id").onDelete("cascade"),
		)
		.addColumn("total_processed", "bigint", (col) => col.notNull())
		.addColumn("total_errors", "bigint", (col) => col.notNull())
		.addColumn("last_processed_block", "integer")
		.addColumn("captured_at", "timestamptz", (col) =>
			col.notNull().defaultTo(db.fn("now")),
		)
		.execute();

	await db.schema
		.createIndex("idx_view_health_snapshots_view_captured")
		.on("view_health_snapshots")
		.columns(["view_id", "captured_at"])
		.execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("view_health_snapshots").execute();
}
