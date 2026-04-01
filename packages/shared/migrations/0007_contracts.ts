import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
	// Enable pg_trgm for fast ILIKE search
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

	// Backfill step 1: insert deployed contracts from transactions
	await sql`
    INSERT INTO contracts (contract_id, name, deployer, deploy_block, deploy_tx_id, created_at)
    SELECT DISTINCT ON (contract_id)
      contract_id,
      split_part(contract_id, '.', 2),
      sender,
      block_height,
      tx_id,
      created_at
    FROM transactions
    WHERE type = 'smart_contract' AND contract_id IS NOT NULL
    ORDER BY contract_id, block_height ASC
    ON CONFLICT (contract_id) DO NOTHING
  `.execute(db);

	// Backfill step 2: update call counts from contract_call transactions
	await sql`
    UPDATE contracts c
    SET call_count = sub.cnt, last_called_at = sub.last_call
    FROM (
      SELECT contract_id, COUNT(*)::int AS cnt, MAX(created_at) AS last_call
      FROM transactions
      WHERE type = 'contract_call' AND contract_id IS NOT NULL
      GROUP BY contract_id
    ) sub
    WHERE c.contract_id = sub.contract_id
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("contracts").ifExists().cascade().execute();
}
