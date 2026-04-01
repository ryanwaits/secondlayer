import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("account_insights")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(db.fn("gen_random_uuid")),
		)
		.addColumn("account_id", "uuid", (col) =>
			col.notNull().references("accounts.id"),
		)
		.addColumn("category", "text", (col) => col.notNull())
		.addColumn("insight_type", "text", (col) => col.notNull())
		.addColumn("resource_id", "text")
		.addColumn("severity", "text", (col) => col.notNull())
		.addColumn("title", "text", (col) => col.notNull())
		.addColumn("body", "text", (col) => col.notNull())
		.addColumn("data", "jsonb")
		.addColumn("dismissed_at", "timestamptz")
		.addColumn("expires_at", "timestamptz")
		.addColumn("created_at", "timestamptz", (col) =>
			col.notNull().defaultTo(db.fn("now")),
		)
		.execute();

	await db.schema
		.createIndex("idx_account_insights_account")
		.on("account_insights")
		.column("account_id")
		.execute();

	await db.schema
		.createTable("account_agent_runs")
		.addColumn("id", "uuid", (col) =>
			col.primaryKey().defaultTo(db.fn("gen_random_uuid")),
		)
		.addColumn("account_id", "uuid", (col) =>
			col.notNull().references("accounts.id"),
		)
		.addColumn("started_at", "timestamptz", (col) =>
			col.notNull().defaultTo(db.fn("now")),
		)
		.addColumn("completed_at", "timestamptz")
		.addColumn("status", "text", (col) => col.notNull().defaultTo("running"))
		.addColumn("input_tokens", "integer", (col) => col.defaultTo(0))
		.addColumn("output_tokens", "integer", (col) => col.defaultTo(0))
		.addColumn("cost_usd", sql`numeric(10,6)`, (col) => col.defaultTo(0))
		.addColumn("insights_created", "integer", (col) => col.defaultTo(0))
		.addColumn("error", "text")
		.execute();

	await db.schema
		.createIndex("idx_account_agent_runs_account")
		.on("account_agent_runs")
		.column("account_id")
		.execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("account_agent_runs").execute();
	await db.schema.dropTable("account_insights").execute();
}
