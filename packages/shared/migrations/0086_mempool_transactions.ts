import { type Kysely, sql } from "kysely";

// Pending (unconfirmed) transactions captured directly from the Stacks node's
// /new_mempool_tx observer callback. Mempool is pre-chain: no block_height /
// tx_index / result / events, and never canonical or finalized. Rows are
// evicted when the tx confirms (block ingest) or drops (/drop_mempool_tx), and
// a retention sweep clears stuck rows. The node POSTs only raw_tx hex, so tx_id
// is derived from it. Ingest runs on every indexer instance, so writes are
// idempotent on tx_id.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);

	await sql`
		CREATE TABLE IF NOT EXISTS mempool_transactions (
			seq BIGSERIAL PRIMARY KEY,
			tx_id TEXT NOT NULL UNIQUE,
			raw_tx TEXT NOT NULL,
			type TEXT NOT NULL,
			sender TEXT NOT NULL,
			contract_id TEXT,
			function_name TEXT,
			function_args JSONB,
			received_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`.execute(db);

	await sql`CREATE INDEX IF NOT EXISTS mempool_transactions_sender_idx ON mempool_transactions (sender)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS mempool_transactions_received_at_idx ON mempool_transactions (received_at)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS mempool_transactions`.execute(db);
}
