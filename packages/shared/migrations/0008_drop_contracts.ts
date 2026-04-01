import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("contracts").ifExists().cascade().execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

	await db.schema
		.createTable("contracts")
		.addColumn("contract_id", "text", (c) => c.primaryKey())
		.addColumn("name", "text", (c) => c.notNull())
		.addColumn("deployer", "text", (c) => c.notNull())
		.addColumn("deploy_block", "integer", (c) => c.notNull())
		.addColumn("deploy_tx_id", "text", (c) => c.notNull())
		.addColumn("call_count", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("last_called_at", "timestamptz")
		.addColumn("abi", "jsonb")
		.addColumn("abi_fetched_at", "timestamptz")
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`NOW()`),
		)
		.addColumn("updated_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`NOW()`),
		)
		.execute();

	await db.schema
		.createIndex("contracts_name_idx")
		.on("contracts")
		.column("name")
		.execute();
	await db.schema
		.createIndex("contracts_deployer_idx")
		.on("contracts")
		.column("deployer")
		.execute();
	await sql`CREATE INDEX contracts_name_trgm_idx ON contracts USING gin(name gin_trgm_ops)`.execute(
		db,
	);
}
