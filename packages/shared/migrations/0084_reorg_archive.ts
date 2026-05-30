import { type Kysely, sql } from "kysely";

// Reorg archive: when a reorg reuses a height, the indexer replaces the
// transactions/events at that height (persistBlock). Previously the orphaned
// rows were DELETEd outright. Instead, we now copy them here first so the raw
// log is preserved (queryable + auditable) rather than destroyed — the
// "immutable log" the availability layer promises. Append-only; a synthetic
// archive_id lets the same original row be archived across multiple reorgs.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`
		CREATE TABLE IF NOT EXISTS transactions_archive (
			archive_id BIGSERIAL PRIMARY KEY,
			tx_id TEXT NOT NULL,
			block_height BIGINT NOT NULL,
			tx_index INTEGER NOT NULL,
			type TEXT NOT NULL,
			sender TEXT NOT NULL,
			status TEXT NOT NULL,
			contract_id TEXT,
			function_name TEXT,
			function_args JSONB,
			raw_result TEXT,
			raw_tx TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL,
			orphaned_block_hash TEXT,
			archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS transactions_archive_height_idx ON transactions_archive (block_height)`.execute(
		db,
	);

	await sql`
		CREATE TABLE IF NOT EXISTS events_archive (
			archive_id BIGSERIAL PRIMARY KEY,
			id TEXT NOT NULL,
			tx_id TEXT NOT NULL,
			block_height BIGINT NOT NULL,
			event_index INTEGER NOT NULL,
			type TEXT NOT NULL,
			data JSONB,
			created_at TIMESTAMPTZ NOT NULL,
			orphaned_block_hash TEXT,
			archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS events_archive_height_idx ON events_archive (block_height)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS events_archive`.execute(db);
	await sql`DROP TABLE IF EXISTS transactions_archive`.execute(db);
}
