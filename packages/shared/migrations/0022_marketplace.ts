import { type Kysely, sql } from "kysely";

/**
 * Add marketplace columns to subgraphs and accounts.
 * Create per-subgraph usage tracking table.
 */
// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	// Subgraph marketplace columns
	await db.schema
		.alterTable("subgraphs")
		.addColumn("is_public", "boolean", (c) => c.notNull().defaultTo(false))
		.execute();
	await db.schema
		.alterTable("subgraphs")
		.addColumn("tags", sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
		.execute();
	await db.schema
		.alterTable("subgraphs")
		.addColumn("description", "text")
		.execute();
	await db.schema
		.alterTable("subgraphs")
		.addColumn("forked_from_id", "uuid", (c) =>
			c.references("subgraphs.id").onDelete("set null"),
		)
		.execute();

	// Account profile columns
	await db.schema
		.alterTable("accounts")
		.addColumn("display_name", "text")
		.execute();
	await db.schema.alterTable("accounts").addColumn("bio", "text").execute();
	await db.schema
		.alterTable("accounts")
		.addColumn("avatar_url", "text")
		.execute();
	await db.schema
		.alterTable("accounts")
		.addColumn("slug", "text", (c) => c.unique())
		.execute();

	// Per-subgraph usage tracking
	await db.schema
		.createTable("subgraph_usage_daily")
		.addColumn("subgraph_id", "uuid", (c) =>
			c.notNull().references("subgraphs.id").onDelete("cascade"),
		)
		.addColumn("date", "date", (c) => c.notNull())
		.addColumn("query_count", "integer", (c) => c.notNull().defaultTo(0))
		.addPrimaryKeyConstraint("subgraph_usage_daily_pk", ["subgraph_id", "date"])
		.execute();

	// Indexes
	await sql`CREATE INDEX subgraphs_is_public_idx ON subgraphs (is_public) WHERE is_public = true`.execute(
		db,
	);
	await sql`CREATE INDEX subgraphs_tags_idx ON subgraphs USING gin (tags)`.execute(
		db,
	);
	await sql`CREATE INDEX accounts_slug_idx ON accounts (slug) WHERE slug IS NOT NULL`.execute(
		db,
	);
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("subgraph_usage_daily").execute();

	await sql`DROP INDEX IF EXISTS accounts_slug_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS subgraphs_tags_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS subgraphs_is_public_idx`.execute(db);

	await db.schema.alterTable("accounts").dropColumn("slug").execute();
	await db.schema.alterTable("accounts").dropColumn("avatar_url").execute();
	await db.schema.alterTable("accounts").dropColumn("bio").execute();
	await db.schema.alterTable("accounts").dropColumn("display_name").execute();

	await db.schema
		.alterTable("subgraphs")
		.dropColumn("forked_from_id")
		.execute();
	await db.schema.alterTable("subgraphs").dropColumn("description").execute();
	await db.schema.alterTable("subgraphs").dropColumn("tags").execute();
	await db.schema.alterTable("subgraphs").dropColumn("is_public").execute();
}
