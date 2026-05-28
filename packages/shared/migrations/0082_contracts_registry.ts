import { type Kysely, sql } from "kysely";

// Contract registry for trait-based discovery ("find all SIP-010 tokens"). One
// row per deployed contract with its fetched ABI, declared traits (parsed from
// Clarity source), and statically-inferred SIP standards. `canonical` mirrors
// chain reorgs. The partial index on transactions makes the deploy backfill
// (WHERE type='smart_contract') an index scan, not a full-table seq scan.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE contracts (
			contract_id        TEXT PRIMARY KEY,
			deployer           TEXT NOT NULL,
			block_height       BIGINT NOT NULL,
			canonical          BOOLEAN NOT NULL DEFAULT TRUE,
			abi                JSONB,
			declared_traits    TEXT[] NOT NULL DEFAULT '{}',
			inferred_standards TEXT[] NOT NULL DEFAULT '{}',
			abi_status         TEXT NOT NULL DEFAULT 'pending',
			abi_fetched_at     TIMESTAMPTZ,
			created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`.execute(db);

	// Discovery query path: filter by inferred standard / declared trait.
	await sql`CREATE INDEX contracts_inferred_standards_idx ON contracts USING gin (inferred_standards)`.execute(
		db,
	);
	await sql`CREATE INDEX contracts_declared_traits_idx ON contracts USING gin (declared_traits)`.execute(
		db,
	);
	// As-of-block trait resolution (B4) reads by block_height for canonical rows.
	await sql`CREATE INDEX contracts_block_height_idx ON contracts (block_height) WHERE canonical`.execute(
		db,
	);
	// Deploy backfill: avoid seq-scanning the whole transactions table.
	await sql`CREATE INDEX transactions_smart_contract_idx ON transactions (contract_id) WHERE type = 'smart_contract'`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS transactions_smart_contract_idx`.execute(db);
	await sql`DROP TABLE IF EXISTS contracts`.execute(db);
}
