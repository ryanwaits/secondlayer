import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Durable receipt log for state-affecting Stacks observer callbacks.
 *
 * The raw body is immutable evidence. Processing fields are deliberately
 * separate so a callback can be recovered and replayed if the indexer dies
 * after the receipt is durable but before derived state commits.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE IF NOT EXISTS observer_journal (
				sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				network TEXT NOT NULL,
				path TEXT NOT NULL,
				source TEXT,
				received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				raw_body BYTEA NOT NULL,
				raw_body_sha256 TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'received',
				semantic_sha256 TEXT,
				block_height BIGINT,
				block_hash TEXT,
				burn_block_height BIGINT,
				burn_block_hash TEXT,
				result JSONB,
				error TEXT,
				processed_at TIMESTAMPTZ,
				CONSTRAINT observer_journal_status_check
					CHECK (status IN ('received', 'processed', 'failed'))
			)
		`.execute(db);

		await sql`
			CREATE INDEX IF NOT EXISTS observer_journal_path_sequence_idx
				ON observer_journal (path, sequence)
		`.execute(db);

		await sql`
			CREATE INDEX IF NOT EXISTS observer_journal_status_sequence_idx
				ON observer_journal (status, sequence)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS observer_journal`.execute(db);
	});
}
